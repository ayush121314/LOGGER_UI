'use strict'

const fs = require('fs')
const cfg = require('../shared/config')
const { PUBLIC_DIR, PORT_FILE, PID_FILE, ensureStateDir, readPortFile } = require('../shared/paths')
const { healthCheck } = require('../shared/health')
const { EventParser } = require('../parsing/EventParser')
const RingBuffer = require('./RingBuffer')
const SegmentStore = require('./SegmentStore')
const StreamRegistry = require('./StreamRegistry')
const SseHub = require('./SseHub')
const Ingestor = require('./Ingestor')
const QueryService = require('./QueryService')
const PortDetector = require('./PortDetector')
const DaemonLock = require('./DaemonLock')
const { chooseAndListen } = require('./PortBinder')
const { createServer } = require('./router/httpServer')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const writePort = (p) => { try { fs.writeFileSync(PORT_FILE, String(p)) } catch (e) {} }

class Daemon {
  async start () {
    ensureStateDir()
    if (await healthCheck(cfg.PREFERRED_PORT)) { writePort(cfg.PREFERRED_PORT); process.exit(0) }

    const lock = new DaemonLock()
    let got = lock.acquire()
    for (let i = 0; i < 30 && !got; i++) {
      await sleep(200)
      if (await healthCheck(cfg.PREFERRED_PORT)) process.exit(0)
      const pf = readPortFile()
      if (pf && pf !== cfg.PREFERRED_PORT && await healthCheck(pf)) process.exit(0)
      if (i >= 20) lock.release()
      got = lock.acquire()
    }
    process.on('exit', () => lock.release())
    process.on('SIGTERM', () => process.exit(0))
    process.on('SIGINT', () => process.exit(0))

    this.daemonPort = cfg.PREFERRED_PORT

    const parser = new EventParser()
    const ring = new RingBuffer(cfg.MAX_BUFFER)
    const store = new SegmentStore(parser, { logsDir: cfg.LOGS_DIR, persist: cfg.PERSIST, backpressureBytes: cfg.WRITE_BACKPRESSURE_BYTES })
    const portsMap = cfg.PERSIST ? store.loadPorts() : {}
    const registry = new StreamRegistry({ palette: cfg.PALETTE, portsMap, persistPorts: (m) => store.savePorts(m) })
    const hub = new SseHub({ snapshotProvider: () => ({ streams: registry.all(), events: ring.recent(cfg.SNAPSHOT_LIMIT) }), liveBatch: cfg.LIVE_BATCH })
    const ingestor = new Ingestor(parser, ring, store, registry, hub)
    const queryService = new QueryService(store, registry)
    const portDetector = new PortDetector()

    registry.on('stream', (s) => hub.broadcast({ type: 'stream', stream: s }))

    if (cfg.PERSIST) {
      store.ensureLogsDir()
      for (const repo of store.listRepos()) {
        const segs = store.listSegs(repo)
        if (!segs.length) continue
        registry.seedPast(repo, store.segMtime(repo, segs[segs.length - 1]))
      }
      setTimeout(() => store.prune(cfg.RETAIN_MS), 500)
      setInterval(() => store.prune(cfg.RETAIN_MS), 6 * 3600 * 1000)
    }

    hub.startFlushTimer()
    setInterval(() => {
      const rates = []
      for (const s of registry.all()) { s.rate = s.rateCount || 0; s.rateCount = 0; rates.push({ name: s.name, rate: s.rate }) }
      if (rates.length) hub.broadcast({ type: 'rates', rates })
    }, 1000)

    const server = createServer({ registry, store, hub, ingestor, queryService, portDetector, publicDir: PUBLIC_DIR, getDaemonPort: () => this.daemonPort })

    const candidates = []
    for (let p = cfg.PREFERRED_PORT; p >= cfg.PREFERRED_PORT - 9 && p > 1024; p--) candidates.push(p)
    candidates.push(0)
    const r = await chooseAndListen(server, candidates)
    if (r.existing) { writePort(r.existing); lock.release(); process.exit(0) }
    if (!r.port) { process.stderr.write('logapp: no free port\n'); lock.release(); process.exit(1) }
    this.daemonPort = r.port
    writePort(r.port)
    try { fs.writeFileSync(PID_FILE, String(process.pid)) } catch (e) {}
    server.on('error', (err) => { process.stderr.write('logapp daemon error: ' + err.message + '\n') })
    process.stdout.write('logapp daemon listening on http://' + cfg.HOST + ':' + r.port + '\n')
  }
}

module.exports = Daemon
