'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const Router = require('./Router')
const LineSplitter = require('../../shared/LineSplitter')
const { HOST } = require('../../shared/config')

function createServer (deps) {
  const { registry, store, hub, ingestor, queryService, portDetector, publicDir, getDaemonPort } = deps
  const router = new Router()

  router.get('/health', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, pid: process.pid, streams: registry.size }))
  })

  router.get('/streams', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(registry.all()))
  })

  router.get('/query', (req, res, url) => {
    const n = (k) => { const v = Number(url.searchParams.get(k)); return v || 0 }
    const streamParam = url.searchParams.get('stream')
    const lv = url.searchParams.get('levels')
    const opts = { from: n('from'), to: n('to'), before: n('before'), q: url.searchParams.get('q') || '', levels: lv ? new Set(lv.split(',')) : null, limit: Math.min(5000, n('limit') || 1000) }
    queryService.query(streamParam, opts, (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    })
  })

  router.get('/events', (req, res) => { hub.addClient(req, res) })

  router.post('/ingest', (req, res, url) => {
    const name = (url.searchParams.get('name') || 'stream').slice(0, 60)
    registry.register(name)
    registry.incConns(name)
    store.open(name)
    let connPort = null
    portDetector.detect({
      pgid: url.searchParams.get('pgid'),
      clientPid: url.searchParams.get('pid'),
      excludePort: getDaemonPort(),
      isActive: () => !!registry.get(name),
      onFound: (p) => { connPort = p; registry.addPort(name, p) }
    })
    const splitter = new LineSplitter((line) => ingestor.ingestLine(line, name))
    req.setEncoding('utf8')
    req.on('data', (c) => splitter.push(c))
    req.on('end', () => { splitter.end(); res.writeHead(200); res.end('ok') })
    req.on('close', () => {
      const st = registry.get(name)
      if (!st) return
      if (connPort) registry.removePort(name, connPort)
      registry.decConns(name)
      if (st.conns === 0) { store.close(name); registry.setStatusSilent(name, 'past') }
      registry.emitStream(name)
    })
  })

  router.get((pn) => pn === '/' || pn === '/index.html', (req, res) => {
    fs.readFile(path.join(publicDir, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('index missing'); return }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' })
      res.end(data)
    })
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + HOST)
    if (!router.handle(req, res, url)) { res.writeHead(404); res.end('not found') }
  })

  server.requestTimeout = 0
  server.headersTimeout = 0
  server.keepAliveTimeout = 0
  server.timeout = 0
  return server
}

module.exports = { createServer }
