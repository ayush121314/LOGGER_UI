'use strict'

class Ingestor {
  constructor (parser, ring, store, registry, hub) {
    this.parser = parser
    this.ring = ring
    this.store = store
    this.registry = registry
    this.hub = hub
    this.seq = 0
  }

  ingestLine (line, streamName) {
    const ev = this.parser.parse(line, streamName)
    if (!ev) return
    const s = this.registry.register(ev.stream)
    s.count++
    s.rateCount = (s.rateCount || 0) + 1
    s.lastTs = ev.ts
    ev.id = ++this.seq
    ev.color = s.color
    this.ring.push(ev)
    this.store.write(ev)
    this.hub.enqueue(ev)
  }
}

module.exports = Ingestor
