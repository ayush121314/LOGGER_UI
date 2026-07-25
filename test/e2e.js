'use strict'

const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const LOGAPP = path.join(__dirname, '..', 'bin', 'logapp.js')
const TEST_LOGS = path.join(os.tmpdir(), 'logapp-e2e-logs')
const PORT_FILE = path.join(os.homedir(), '.logapp', 'daemon.port')
const PORT = 9788
const results = []
const check = (n, c, x) => results.push({ n, p: !!c, x: x || '' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function get (port, p) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 1500 }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c }); res.on('end', () => resolve({ code: res.statusCode, body: d }))
    })
    req.on('error', () => resolve({ code: 0, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '' }) })
  })
}
async function waitHealth (port, tries = 40) { for (let i = 0; i < tries; i++) { const r = await get(port, '/health'); if (r.code === 200) return true; await sleep(150) } return false }
function spawnDaemon (env) { return spawn(process.execPath, [LOGAPP, '--daemon'], { env: Object.assign({}, process.env, env), stdio: 'ignore' }) }
function openIngest (port, name) {
  const req = http.request({ host: '127.0.0.1', port, path: '/ingest?name=' + name + '&pid=' + process.pid, method: 'POST', headers: { 'Content-Type': 'text/plain' } }, (r) => r.resume())
  req.on('error', () => {})
  return req
}
function readSnapshot (port) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      let d = ''; res.setEncoding('utf8')
      res.on('data', (c) => { d += c; const m = d.match(/data: (.*)\n\n/); if (m) { r.destroy(); resolve(JSON.parse(m[1])) } })
    })
    r.on('error', () => resolve(null))
    setTimeout(() => { try { r.destroy() } catch (e) {} resolve(null) }, 2000)
  })
}

;(async () => {
  try { fs.rmSync(TEST_LOGS, { recursive: true, force: true }) } catch (e) {}
  try { fs.unlinkSync(PORT_FILE) } catch (e) {}
  const env = { LOGAPP_PORT: String(PORT), LOGAPP_LOGS_DIR: TEST_LOGS, LOGAPP_SNAPSHOT: '50', LOGAPP_BUFFER: '2000' }

  const d1 = spawnDaemon(env)
  check('daemon starts + /health ok', await waitHealth(PORT))
  check('daemon.port file = ' + PORT, fs.existsSync(PORT_FILE) && fs.readFileSync(PORT_FILE, 'utf8').trim() === String(PORT))

  const req = openIngest(PORT, 't1')
  for (let i = 0; i < 12; i++) req.write(JSON.stringify({ level: 30, time: Date.now(), msg: 'line ' + i, event: 'e' }) + '\n')
  await sleep(600)
  const streams = JSON.parse((await get(PORT, '/streams')).body || '[]')
  check('stream registered', streams.some((s) => s.name === 't1'))
  const file = path.join(TEST_LOGS, 't1.jsonl')
  check('log file saved in LOGS_DIR', fs.existsSync(file) && fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length >= 12)

  for (let i = 0; i < 200; i++) req.write(JSON.stringify({ level: 30, time: Date.now(), msg: 'bulk ' + i }) + '\n')
  await sleep(600)
  const snap = await readSnapshot(PORT)
  check('snapshot capped to SNAPSHOT_LIMIT (50)', snap && snap.events.length <= 50, snap ? snap.events.length + ' events' : 'no snapshot')

  const qr = JSON.parse((await get(PORT, '/query?stream=t1&limit=5')).body || '{}')
  check('/query returns recent lines', qr.events && qr.events.length === 5, (qr.events || []).length + ' events')
  const qs = JSON.parse((await get(PORT, '/query?stream=t1&q=line&limit=50')).body || '{}')
  check('/query full-text search (q=line)', qs.events && qs.events.length > 0 && qs.events.every((e) => e.raw.toLowerCase().includes('line')), (qs.events || []).length + ' matches')
  const newest = qr.events[qr.events.length - 1].ts
  const older = JSON.parse((await get(PORT, '/query?stream=t1&before=' + newest + '&limit=5')).body || '{}')
  check('/query before-cursor (older only)', older.events && older.events.length > 0 && older.events.every((e) => e.ts < newest))

  req.destroy()
  await sleep(1200)
  check('log file deleted when port ends', !fs.existsSync(file))

  try { process.kill(d1.pid) } catch (e) {}
  await sleep(600)

  const foreign = http.createServer((q, r) => r.end('foreign')).listen(PORT, '127.0.0.1')
  await sleep(300)
  try { fs.unlinkSync(PORT_FILE) } catch (e) {}
  const d2 = spawnDaemon(env)
  check('port fallback when 9788 busy', await waitHealth(PORT - 1))
  check('daemon.port = fallback ' + (PORT - 1), fs.existsSync(PORT_FILE) && fs.readFileSync(PORT_FILE, 'utf8').trim() === String(PORT - 1))
  try { process.kill(d2.pid) } catch (e) {}
  foreign.close()

  let pass = 0
  console.log('\n===== logapp backend E2E =====')
  results.forEach((r) => { console.log((r.p ? 'PASS' : 'FAIL') + '  ' + r.n + (r.x ? '  (' + r.x + ')' : '')); if (r.p) pass++ })
  console.log('-----------------------------')
  console.log(pass + '/' + results.length + ' passed')
  try { fs.rmSync(TEST_LOGS, { recursive: true, force: true }) } catch (e) {}
  try { fs.unlinkSync(PORT_FILE) } catch (e) {}
  process.exit(pass === results.length ? 0 : 1)
})().catch((e) => { console.error('E2E ERROR:', e.stack || e.message); process.exit(2) })
