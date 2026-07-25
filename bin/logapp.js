#!/usr/bin/env node
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, exec, execSync } = require('child_process')

const PREFERRED = Number(process.env.LOGAPP_PORT || 9999)
const HOST = '127.0.0.1'
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const STATE_DIR = path.join(os.homedir(), '.logapp')
const LOGS_DIR = process.env.LOGAPP_LOGS_DIR || path.join(os.homedir(), 'Downloads', 'logapp-logs')
const PID_FILE = path.join(STATE_DIR, 'daemon.pid')
const PORT_FILE = path.join(STATE_DIR, 'daemon.port')
const LOCK_FILE = path.join(STATE_DIR, 'daemon.lock')
const DAEMON_LOG = path.join(STATE_DIR, 'daemon.log')
const MAX_BUFFER = Number(process.env.LOGAPP_BUFFER) || 20000
const SNAPSHOT_LIMIT = Number(process.env.LOGAPP_SNAPSHOT) || 4000
const LIVE_BATCH = Number(process.env.LOGAPP_LIVE_BATCH) || 400
const PERSIST = process.env.LOGAPP_PERSIST !== '0'
const MAX_FILE_BYTES = (Number(process.env.LOGAPP_MAX_FILE_MB) || 2048) * 1024 * 1024

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

function acquireLock () { try { fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' }); return true } catch (e) { return false } }
function releaseLock () { try { fs.unlinkSync(LOCK_FILE) } catch (e) {} }

async function runDaemon () {
  ensureStateDir()
  if (await healthCheck(PREFERRED)) { try { fs.writeFileSync(PORT_FILE, String(PREFERRED)) } catch (e) {} process.exit(0) }

  let got = acquireLock()
  for (let i = 0; i < 30 && !got; i++) {
    await new Promise((r) => setTimeout(r, 200))
    if (await healthCheck(PREFERRED)) process.exit(0)
    const pf = readPortFile()
    if (pf && pf !== PREFERRED && await healthCheck(pf)) process.exit(0)
    if (i >= 20) releaseLock()
    got = acquireLock()
  }
  process.on('exit', releaseLock)
  process.on('SIGTERM', () => process.exit(0))
  process.on('SIGINT', () => process.exit(0))

  let daemonPort = PREFERRED

  const streams = new Map()
  const buffer = []
  const pending = []
  const clients = new Set()
  const streamFiles = new Map()
  let seq = 0
  let colorIdx = 0

  if (PERSIST) {
    try {
      fs.mkdirSync(LOGS_DIR, { recursive: true })
      for (const f of fs.readdirSync(LOGS_DIR)) { try { fs.unlinkSync(path.join(LOGS_DIR, f)) } catch (e) {} }
    } catch (e) {}
  }
  const safeName = (n) => n.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
  const fileFor = (name) => path.join(LOGS_DIR, safeName(name) + '.jsonl')
  const openFile = (name) => { if (PERSIST && !streamFiles.has(name)) { try { streamFiles.set(name, { ws: fs.createWriteStream(fileFor(name), { flags: 'w' }), bytes: 0 }) } catch (e) {} } }
  const writeToFile = (ev) => {
    const f = streamFiles.get(ev.stream)
    if (!f || f.ws.writableLength > 8 * 1024 * 1024) return
    const line = ev.raw + '\n'
    f.ws.write(line)
    f.bytes += line.length
    if (f.bytes > MAX_FILE_BYTES) {
      try { f.ws.end() } catch (e) {}
      try { fs.unlinkSync(fileFor(ev.stream)) } catch (e) {}
      try { f.ws = fs.createWriteStream(fileFor(ev.stream), { flags: 'w' }); f.bytes = 0 } catch (e) {}
    }
  }
  const closeDeleteFile = (name) => {
    const f = streamFiles.get(name)
    if (f) { try { f.ws.end() } catch (e) {} streamFiles.delete(name) }
    if (PERSIST) fs.unlink(fileFor(name), () => {})
  }

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
      if (tries > 20) { clearInterval(timer); return }
      const s = streams.get(name)
      if (!s || s.port) { clearInterval(timer); return }
      exec('ps -ax -o pid=,ppid=,pgid=', (e, psout) => {
        if (e || !psout) return
        const childrenOf = new Map()
        const pgidOf = new Map()
        psout.split('\n').forEach((line) => {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/)
          if (!m) return
          pgidOf.set(m[1], m[3])
          if (!childrenOf.has(m[2])) childrenOf.set(m[2], [])
          childrenOf.get(m[2]).push(m[1])
        })
        const allowed = new Set()
        const stack = []
        pgidOf.forEach((pg, pid) => { if (pg === String(pgid)) { allowed.add(pid); stack.push(pid) } })
        while (stack.length) {
          const pid = stack.pop()
          ;(childrenOf.get(pid) || []).forEach((k) => { if (!allowed.has(k)) { allowed.add(k); stack.push(k) } })
        }
        exec('lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null', (e2, lout) => {
          if (e2 || !lout) return
          let cur = null, found = null
          lout.split('\n').forEach((line) => {
            if (line[0] === 'p') cur = line.slice(1)
            else if (line[0] === 'n') {
              const m = line.slice(1).match(/:(\d+)$/)
              if (m && cur && allowed.has(cur) && cur !== String(clientPid) && m[1] !== String(daemonPort) && !found) found = m[1]
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
    s.rateCount = (s.rateCount || 0) + 1
    s.lastTs = ev.ts
    ev.id = ++seq
    ev.color = s.color
    buffer.push(ev)
    if (buffer.length > MAX_BUFFER * 1.3) buffer.splice(0, buffer.length - MAX_BUFFER)
    writeToFile(ev)
    pending.push(ev)
    if (pending.length > LIVE_BATCH * 4) pending.splice(0, pending.length - LIVE_BATCH * 2)
  }

  setInterval(() => {
    if (!pending.length || !clients.size) { pending.length = 0; return }
    const batch = pending.length > LIVE_BATCH ? pending.slice(-LIVE_BATCH) : pending.slice()
    const dropped = pending.length - batch.length
    pending.length = 0
    broadcast({ type: 'logs', events: batch, dropped })
  }, 200)

  setInterval(() => {
    const rates = []
    for (const s of streams.values()) { s.rate = s.rateCount || 0; s.rateCount = 0; rates.push({ name: s.name, rate: s.rate }) }
    if (rates.length) broadcast({ type: 'rates', rates })
  }, 1000)

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
      sseWrite(res, { type: 'snapshot', streams: Array.from(streams.values()), events: buffer.slice(-SNAPSHOT_LIMIT) })
      clients.add(res)
      const ping = setInterval(() => { try { res.write(': ping\n\n') } catch (e) {} }, 20000)
      req.on('close', () => { clearInterval(ping); clients.delete(res) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/ingest') {
      const name = (url.searchParams.get('name') || 'stream').slice(0, 60)
      registerStream(name)
      openFile(name)
      detectPort(name, url.searchParams.get('pgid'), url.searchParams.get('pid'))
      const splitter = new LineSplitter((line) => ingestEvent(parseLine(line, name)))
      req.setEncoding('utf8')
      req.on('data', (c) => splitter.push(c))
      req.on('end', () => {
        splitter.end()
        res.writeHead(200); res.end('ok')
      })
      req.on('close', () => { closeDeleteFile(name); setStreamStatus(name, 'ended') })
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

  const candidates = []
  for (let p = PREFERRED; p >= PREFERRED - 9 && p > 1024; p--) candidates.push(p)
  candidates.push(0)
  chooseAndListen(server, candidates).then((r) => {
    if (r.existing) { try { fs.writeFileSync(PORT_FILE, String(r.existing)) } catch (e) {} releaseLock(); process.exit(0) }
    if (!r.port) { process.stderr.write('logapp: no free port\n'); releaseLock(); process.exit(1) }
    daemonPort = r.port
    try { fs.writeFileSync(PORT_FILE, String(r.port)) } catch (e) {}
    try { fs.writeFileSync(PID_FILE, String(process.pid)) } catch (e) {}
    server.on('error', (err) => { process.stderr.write('logapp daemon error: ' + err.message + '\n') })
    process.stdout.write('logapp daemon listening on http://' + HOST + ':' + r.port + '\n')
  })
}

async function chooseAndListen (server, candidates) {
  for (const p of candidates) {
    if (p !== 0 && await healthCheck(p)) return { existing: p }
    const bound = await tryListen(server, p)
    if (bound) return { port: bound }
  }
  return {}
}

function tryListen (server, p) {
  return new Promise((resolve) => {
    const onErr = () => { server.removeListener('error', onErr); resolve(0) }
    server.once('error', onErr)
    server.listen(p, HOST, () => { server.removeListener('error', onErr); resolve(server.address().port) })
  })
}

function healthCheck (port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/health', timeout: 800 }, (res) => {
      let d = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { d += c })
      res.on('end', () => resolve(res.statusCode === 200 && d.includes('"ok":true')))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

function readPortFile () { try { return Number(fs.readFileSync(PORT_FILE, 'utf8').trim()) || 0 } catch (e) { return 0 } }

function spawnDaemon () {
  ensureStateDir()
  const out = fs.openSync(DAEMON_LOG, 'a')
  const child = spawn(process.execPath, [__filename, '--daemon'], {
    detached: true,
    stdio: ['ignore', out, out]
  })
  child.unref()
}

async function discoverDaemon () {
  if (await healthCheck(PREFERRED)) return { port: PREFERRED, spawned: false }
  const pf = readPortFile()
  if (pf && pf !== PREFERRED && await healthCheck(pf)) return { port: pf, spawned: false }
  spawnDaemon()
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 150))
    const p = readPortFile()
    if (p && await healthCheck(p)) return { port: p, spawned: true }
  }
  return { port: 0, spawned: false }
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

function pipeToDaemon (name, source, port) {
  let req = null
  let up = false
  function open () {
    req = http.request({
      host: HOST, port, path: ingestPath(name),
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
    try { fs.unlinkSync(PORT_FILE) } catch (e) {}
    try { fs.unlinkSync(LOCK_FILE) } catch (e) {}
    return
  }

  const dstate = await discoverDaemon()
  if (!dstate.port) { process.stderr.write('[logapp] could not start daemon\n'); process.exit(1) }
  const url = 'http://localhost:' + dstate.port

  const wrapperIdx = argv.indexOf('--')
  if (wrapperIdx !== -1) {
    const cmdParts = argv.slice(wrapperIdx + 1)
    const name = streamNameFromArgs(argv.slice(0, wrapperIdx))
    const shell = process.env.SHELL || '/bin/sh'
    const child = spawn(shell, ['-c', cmdParts.join(' ')], { stdio: ['inherit', 'pipe', 'pipe'] })
    const req = http.request({
      host: HOST, port: dstate.port, path: ingestPath(name),
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
    pipeToDaemon(name, process.stdin, dstate.port)
    return
  }

  process.stdout.write('logapp UI ready -> ' + url + '\n')
  openBrowser(url)
}

main()
