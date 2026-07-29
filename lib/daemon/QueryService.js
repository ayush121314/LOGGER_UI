'use strict'

class QueryService {
  constructor (store, registry) {
    this.store = store
    this.registry = registry
    this.qseq = 0
  }

  query (streamParam, opts, cb) {
    const names = (streamParam && streamParam !== 'all') ? [streamParam] : this.registry.all().map((s) => s.name)
    if (!names.length) return cb({ events: [], hasMore: false })
    let remaining = names.length
    const all = []
    names.forEach((name) => {
      this.store.queryStreamSegs(name, opts, (evs) => {
        const s = this.registry.get(name)
        evs.forEach((ev) => { ev.stream = name; ev.color = s ? s.color : '#8ab8ff'; ev.id = -(++this.qseq) })
        for (const ev of evs) all.push(ev)
        if (--remaining === 0) {
          all.sort((a, b) => a.ts - b.ts)
          const hasMore = all.length >= opts.limit
          cb({ events: all.slice(-opts.limit), hasMore })
        }
      })
    })
  }
}

module.exports = QueryService
