'use strict'

const EventEmitter = require('events')

class StreamRegistry extends EventEmitter {
  constructor (opts) {
    super()
    this.palette = opts.palette
    this.portsMap = opts.portsMap || {}
    this.persistPorts = opts.persistPorts || (() => {})
    this.streams = new Map()
    this.colorIdx = 0
  }

  _nextColor () { return this.palette[this.colorIdx++ % this.palette.length] }

  get (name) { return this.streams.get(name) }
  all () { return Array.from(this.streams.values()) }
  get size () { return this.streams.size }
  emitStream (name) { const s = this.streams.get(name); if (s) this.emit('stream', s) }

  seedPast (name, lastTs) {
    this.streams.set(name, { name, color: this._nextColor(), status: 'past', count: 0, lastTs, ports: (this.portsMap[name] || []).slice(), conns: 0 })
  }

  register (name) {
    const existing = this.streams.get(name)
    if (existing) {
      if (existing.status !== 'live') { existing.status = 'live'; this.emit('stream', existing) }
      return existing
    }
    const s = { name, color: this._nextColor(), status: 'live', count: 0, lastTs: Date.now(), ports: (this.portsMap[name] || []).slice(), conns: 0 }
    this.streams.set(name, s)
    this.emit('stream', s)
    return s
  }

  addPort (name, port) {
    const s = this.streams.get(name)
    if (!s) return
    if (s.ports.indexOf(port) === -1) { s.ports.push(port); this.emit('stream', s) }
    this.portsMap[name] = s.ports.slice()
    this.persistPorts(this.portsMap)
  }

  removePort (name, port) {
    const s = this.streams.get(name)
    if (!s) return
    const i = s.ports.indexOf(port)
    if (i !== -1) s.ports.splice(i, 1)
  }

  incConns (name) { const s = this.streams.get(name); if (s) s.conns = (s.conns || 0) + 1 }
  decConns (name) { const s = this.streams.get(name); if (s) s.conns = Math.max(0, (s.conns || 1) - 1) }
  setStatusSilent (name, status) { const s = this.streams.get(name); if (s) s.status = status }
}

module.exports = StreamRegistry
