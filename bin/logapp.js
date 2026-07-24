#!/usr/bin/env node
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, exec, execSync } = require('child_process')

const PORT = Number(process.env.LOGAPP_PORT || 9999)
const HOST = '127.0.0.1'
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const STATE_DIR = path.join(os.homedir(), '.logapp')
const PID_FILE = path.join(STATE_DIR, 'daemon.pid')
const DAEMON_LOG = path.join(STATE_DIR, 'daemon.log')
const MAX_BUFFER = 6000

const PALETTE = ['#4C9AFF', '#57D9A3', '#FFAB00', '#FF5630', '#B37FEB', '#00C7E6', '#F76707', '#20C997', '#845EF7', '#FF8787', '#38D9A9', '#FCC419']

function ensureStateDir () {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }) } catch (e) {}
}

function normalizeLevel (lvl) {
  if (lvl === undefined || lvl === null) return 'info'
  if (typeof lvl === 'number') {
    if (lvl >= 60) return 'fatal'
    if (lvl >= 50) return 'error'
    if (lvl >= 40) return 'warn'
    if (lvl >= 30) return 'info'
    if (lvl >= 20) return 'debug'
    return 'trace'
  }
  const s = String(lvl).toLowerCase()
  if (['trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal'].includes(s)) {
    return s === 'warning' ? 'warn' : s
  }
  return 'info'
}

function guessLevel (line) {
  const l = line.toLowerCase()
  if (/\b(fatal|panic)\b/.test(l)) return 'fatal'
  if (/(error|err!|exception|unhandled|fail(ed|ure)?)/.test(l)) return 'error'
  if (/\bwarn(ing)?\b/.test(l)) return 'warn'
  if (/\bdebug\b/.test(l)) return 'debug'
  return 'info'
}

function parseLine (line, streamName) {
  const trimmed = line.replace(/\s+$/, '')
  if (trimmed.trim() === '') return null
  let level, ts, msg, fields
  const looksJson = trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}'
  if (looksJson) {
    try {
      const obj = JSON.parse(trimmed)
      level = normalizeLevel(obj.level)
      ts = typeof obj.time === 'number' ? obj.time : (Date.parse(obj.time) || Date.now())
      msg = obj.msg || obj.message || obj.event || ''
      fields = obj
    } catch (e) {}
  }
  if (level === undefined) {
    level = guessLevel(trimmed)
    ts = Date.now()
    msg = trimmed
    fields = null
  }
  return { stream: streamName, level, ts, msg: String(msg), raw: trimmed, fields }
}

class LineSplitter {
  constructor (onLine) { this.buf = ''; this.onLine = onLine }
  push (chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      this.onLine(line)
    }
  }
  end () { if (this.buf.length) { this.onLine(this.buf); this.buf = '' } }
}

function runDaemon () {
  ensureStateDir()
  try { fs.writeFileSync(PID_FILE, String(process.pid)) } catch (e) {}

  const streams = new Map()
  const buffer = []
  const clients = new Set()
  let seq = 0
  let colorIdx = 0

  function registerStream (name) {
    if (!streams.has(name)) {
      const color = PALETTE[colorIdx % PALETTE.length]
      colorIdx++
      streams.set(name, { name, color, status: 'running', count: 0, lastTs: Date.now(), port: null })
      broadcast({ type: 'stream', stream: streams.get(name) })
    }
    return streams.get(name)
  }

  function detectPort (name, pgid, clientPid) {
    if (!pgid) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (tries > 14) { clearInterval(timer); return }
      const s = streams.get(name)
      if (!s || s.port) { clearInterval(timer); return }
      exec('ps -o pid= -g ' + pgid, (e, gout) => {
        if (e) return
        const gpids = new Set(gout.split(/\s+/).filter(Boolean))
        exec('lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null', (e2, lout) => {
          if (e2 || !lout) return
          let cur = null, found = null
          lout.split('\n').forEach((line) => {
            if (line[0] === 'p') cur = line.slice(1)
            else if (line[0] === 'n') {
              const m = line.slice(1).match(/:(\d+)$/)
              if (m && cur && gpids.has(cur) && cur !== String(clientPid) && m[1] !== String(PORT) && !found) found = m[1]
            }
          })
          if (found) {
            const st = streams.get(name)
            if (st && !st.port) { st.port = found; broadcast({ type: 'stream', stream: st }) }
            clearInterval(timer)
          }
        })
      })
    }, 1500)
  }

  function setStreamStatus (name, status) {
    const s = streams.get(name)
    if (s) { s.status = status; broadcast({ type: 'stream', stream: s }) }
  }

  function sseWrite (res, obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n')
  }

  function broadcast (obj) {
    for (const res of clients) {
      try { sseWrite(res, obj) } catch (e) {}
    }
  }

  function ingestEvent (ev) {
    if (!ev) return
    const s = registerStream(ev.stream)
    s.count++
    s.lastTs = ev.ts
    ev.id = ++seq
    ev.color = s.color
    buffer.push(ev)
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER)
    broadcast({ type: 'log', event: ev })
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://' + HOST)

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, pid: process.pid, streams: streams.size }))
      return
    }

    if (req.method === 'GET' && url.pathname === '/streams') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(Array.from(streams.values())))
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      res.write('retry: 2000\n\n')
      sseWrite(res, { type: 'snapshot', streams: Array.from(streams.values()), events: buffer })
      clients.add(res)
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch (e) {} }, 20000)
      req.on('close', () => { clearInterval(ping); clients.delete(res) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/ingest') {
      const name = (url.searchParams.get('name') || 'stream').slice(0, 60)
      registerStream(name)
      detectPort(name, url.searchParams.get('pgid'), url.searchParams.get('pid'))
      const splitter = new LineSplitter((line) => ingestEvent(parseLine(line, name)))
      req.setEncoding('utf8')
      req.on('data', (c) => splitter.push(c))
      req.on('end', () => {
        splitter.end()
        setStreamStatus(name, 'ended')
        res.writeHead(200); res.end('ok')
      })
      req.on('error', () => { setStreamStatus(name, 'ended') })
      return
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err, data) => {
        if (err) { res.writeHead(500); res.end('index missing'); return }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' })
        res.end(data)
      })
      return
    }

    res.writeHead(404); res.end('not found')
  })

  server.requestTimeout = 0
  server.headersTimeout = 0
  server.keepAliveTimeout = 0
  server.timeout = 0

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') { process.exit(0) }
    process.stderr.write('logapp daemon error: ' + err.message + '\n')
    process.exit(1)
  })

  server.listen(PORT, HOST, () => {
    process.stdout.write('logapp daemon listening on http://' + HOST + ':' + PORT + '\n')
  })
}

function healthCheck () {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/health', timeout: 800 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function spawnDaemon () {
  ensureStateDir()
  const out = fs.openSync(DAEMON_LOG, 'a')
  const child = spawn(process.execPath, [__filename, '--daemon'], {
    detached: true,
    stdio: ['ignore', out, out]
  })
  child.unref()
}

async function ensureDaemon () {
  if (await healthCheck()) return { ok: true, spawned: false }
  spawnDaemon()
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 150))
    if (await healthCheck()) return { ok: true, spawned: true }
  }
  return { ok: false, spawned: false }
}

function getPgid (pid) {
  try { return execSync('ps -o pgid= -p ' + pid, { encoding: 'utf8' }).trim() } catch (e) { return null }
}

function openBrowser (url) {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open')
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {}
}

function streamNameFromArgs (args) {
  const named = args.find((a) => a && !a.startsWith('-'))
  if (named) return named
  return path.basename(process.cwd()) || 'stream'
}

function ingestPath (name) {
  const pgid = getPgid(process.pid)
  return '/ingest?name=' + encodeURIComponent(name) + '&pid=' + process.pid + (pgid ? '&pgid=' + pgid : '')
}

function pipeToDaemon (name, source) {
  let req = null
  let up = false
  function open () {
    req = http.request({
      host: HOST, port: PORT, path: ingestPath(name),
      method: 'POST', headers: { 'Content-Type': 'text/plain' }
    }, (res) => { res.resume() })
    req.on('error', () => { up = false; setTimeout(open, 1000) })
    up = true
  }
  open()
  const splitter = new LineSplitter((line) => {
    process.stdout.write(line + '\n')
    if (up && req) { try { req.write(line + '\n') } catch (e) {} }
  })
  source.setEncoding('utf8')
  source.on('data', (c) => splitter.push(c))
  source.on('end', () => { splitter.end(); try { if (req) req.end() } catch (e) {} })
  source.on('error', () => { try { if (req) req.end() } catch (e) {} })
}

async function main () {
  const argv = process.argv.slice(2)

  if (argv[0] === '--daemon') { runDaemon(); return }

  if (argv[0] === '--stop') {
    try {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
      process.kill(pid)
      process.stdout.write('logapp daemon stopped (pid ' + pid + ')\n')
    } catch (e) { process.stdout.write('logapp daemon not running\n') }
    return
  }

  const url = 'http://localhost:' + PORT
  const dstate = await ensureDaemon()
  if (!dstate.ok) { process.stderr.write('[logapp] could not start daemon on ' + url + '\n'); process.exit(1) }

  const wrapperIdx = argv.indexOf('--')
  if (wrapperIdx !== -1) {
    const cmdParts = argv.slice(wrapperIdx + 1)
    const name = streamNameFromArgs(argv.slice(0, wrapperIdx))
    const shell = process.env.SHELL || '/bin/sh'
    const child = spawn(shell, ['-c', cmdParts.join(' ')], { stdio: ['inherit', 'pipe', 'pipe'] })
    const req = http.request({
      host: HOST, port: PORT, path: ingestPath(name),
      method: 'POST', headers: { 'Content-Type': 'text/plain' }
    }, (res) => { res.resume() })
    req.on('error', () => {})
    const forward = (chunk, toErr) => {
      (toErr ? process.stderr : process.stdout).write(chunk)
      try { req.write(chunk) } catch (e) {}
    }
    child.stdout.on('data', (c) => forward(c, false))
    child.stderr.on('data', (c) => forward(c, true))
    child.on('close', (code) => { try { req.end() } catch (e) {}; process.exit(code || 0) })
    if (dstate.spawned) openBrowser(url)
    process.stderr.write('[logapp] streaming "' + name + '" -> ' + url + '\n')
    return
  }

  if (!process.stdin.isTTY) {
    const name = streamNameFromArgs(argv)
    if (dstate.spawned) openBrowser(url)
    process.stderr.write('[logapp] streaming "' + name + '" -> ' + url + '\n')
    pipeToDaemon(name, process.stdin)
    return
  }

  process.stdout.write('logapp UI ready -> ' + url + '\n')
  openBrowser(url)
}

main()
