'use strict'

const fs = require('fs')
const path = require('path')
const { dayOf } = require('../shared/time')

class SegmentStore {
  constructor (parser, opts) {
    this.parser = parser
    this.logsDir = opts.logsDir
    this.persist = opts.persist
    this.backpressureBytes = opts.backpressureBytes
    this.portsFile = path.join(this.logsDir, '.ports.json')
    this.streamFiles = new Map()
    this._portsTimer = null
  }

  ensureLogsDir () {
    try { fs.mkdirSync(this.logsDir, { recursive: true }) } catch (e) {}
  }

  safeName (n) { return n.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) }
  repoDir (name) { return path.join(this.logsDir, this.safeName(name)) }
  segPath (name, day) { return path.join(this.repoDir(name), day + '.jsonl') }

  listRepos () {
    try { return fs.readdirSync(this.logsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch (e) { return [] }
  }

  listSegs (name) {
    try { return fs.readdirSync(this.repoDir(name)).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort() } catch (e) { return [] }
  }

  segMtime (name, day) {
    try { return fs.statSync(this.segPath(name, day)).mtimeMs } catch (e) { return Date.now() }
  }

  open (name) {
    if (!this.persist) return
    const day = dayOf(Date.now())
    const cur = this.streamFiles.get(name)
    if (cur && cur.day === day) return
    if (cur) { try { cur.ws.end() } catch (e) {} }
    try { fs.mkdirSync(this.repoDir(name), { recursive: true }) } catch (e) {}
    try { this.streamFiles.set(name, { ws: fs.createWriteStream(this.segPath(name, day), { flags: 'a' }), day }) } catch (e) {}
  }

  write (ev) {
    if (!this.persist) return
    const day = dayOf(ev.ts)
    let f = this.streamFiles.get(ev.stream)
    if (!f || f.day !== day) { this.open(ev.stream); f = this.streamFiles.get(ev.stream) }
    if (!f || f.ws.writableLength > this.backpressureBytes) return
    f.ws.write(ev.raw + '\n')
  }

  close (name) {
    const f = this.streamFiles.get(name)
    if (f) { try { f.ws.end() } catch (e) {} this.streamFiles.delete(name) }
  }

  prune (retainMs) {
    const cutoff = dayOf(Date.now() - retainMs)
    for (const repo of this.listRepos()) {
      for (const day of this.listSegs(repo)) {
        if (day < cutoff) { try { fs.unlinkSync(this.segPath(repo, day)) } catch (e) {} }
      }
    }
  }

  loadPorts () {
    let portsMap = {}
    try { portsMap = JSON.parse(fs.readFileSync(this.portsFile, 'utf8')) } catch (e) { portsMap = {} }
    for (const k in portsMap) { if (!Array.isArray(portsMap[k])) portsMap[k] = portsMap[k] ? [String(portsMap[k])] : [] }
    return portsMap
  }

  savePorts (portsMap) {
    if (this._portsTimer) return
    this._portsTimer = setTimeout(() => {
      this._portsTimer = null
      try { fs.writeFileSync(this.portsFile, JSON.stringify(portsMap)) } catch (e) {}
    }, 1000)
  }

  queryFile (file, opts, cb) {
    const parser = this.parser
    fs.open(file, 'r', (err, fd) => {
      if (err) return cb([])
      fs.fstat(fd, (e2, st) => {
        if (e2 || !st.size) { fs.close(fd, () => {}); return cb([]) }
        let pos = st.size
        let leftover = ''
        const out = []
        const CHUNK = 131072
        const q = opts.q ? opts.q.toLowerCase() : null
        const consider = (line) => {
          if (!line) return 'skip'
          const ev = parser.parse(line, opts.streamName)
          if (!ev) return 'skip'
          if (opts.to && ev.ts > opts.to) return 'skip'
          if (opts.before && ev.ts >= opts.before) return 'skip'
          if (opts.from && ev.ts < opts.from) return 'stop'
          if (opts.levels && !opts.levels.has(ev.level)) return 'skip'
          if (q && ev.raw.toLowerCase().indexOf(q) === -1) return 'skip'
          out.push(ev); return 'add'
        }
        const done = () => { fs.close(fd, () => {}); cb(out.reverse()) }
        const step = () => {
          if (out.length >= opts.limit) return done()
          if (pos <= 0) { if (leftover && consider(leftover) === 'stop') {} return done() }
          const readSize = Math.min(CHUNK, pos)
          pos -= readSize
          const buf = Buffer.allocUnsafe(readSize)
          fs.read(fd, buf, 0, readSize, pos, (e3, bytes) => {
            if (e3) return done()
            const text = buf.toString('utf8', 0, bytes) + leftover
            const lines = text.split('\n')
            leftover = lines.shift()
            for (let i = lines.length - 1; i >= 0; i--) {
              if (out.length >= opts.limit) return done()
              const r = consider(lines[i])
              if (r === 'stop') return done()
            }
            step()
          })
        }
        step()
      })
    })
  }

  queryStreamSegs (name, opts, cb) {
    let days = this.listSegs(name)
    if (opts.from) { const d = dayOf(opts.from); days = days.filter((x) => x >= d) }
    if (opts.to) { const d = dayOf(opts.to); days = days.filter((x) => x <= d) }
    if (opts.before) { const d = dayOf(opts.before); days = days.filter((x) => x <= d) }
    days.reverse()
    const collected = []
    let i = 0
    const stepSeg = () => {
      if (i >= days.length || collected.length >= opts.limit) { collected.sort((a, b) => a.ts - b.ts); return cb(collected.slice(-opts.limit)) }
      this.queryFile(this.segPath(name, days[i++]), Object.assign({ streamName: name }, opts), (evs) => { for (const ev of evs) collected.push(ev); stepSeg() })
    }
    stepSeg()
  }
}

module.exports = SegmentStore
