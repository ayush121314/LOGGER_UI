'use strict'

class SseHub {
  constructor (opts) {
    this.snapshotProvider = opts.snapshotProvider
    this.liveBatch = opts.liveBatch
    this.clients = new Set()
    this.pending = []
    this._flushTimer = null
  }

  _write (res, obj) {
    res.write('data: ' + JSON.stringify(obj) + '\n\n')
  }

  addClient (req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.write('retry: 2000\n\n')
    const snap = this.snapshotProvider()
    this._write(res, { type: 'snapshot', streams: snap.streams, events: snap.events })
    this.clients.add(res)
    const ping = setInterval(() => { try { res.write(': ping\n\n') } catch (e) {} }, 20000)
    req.on('close', () => { clearInterval(ping); this.clients.delete(res) })
  }

  broadcast (obj) {
    for (const res of this.clients) {
      try { this._write(res, obj) } catch (e) {}
    }
  }

  enqueue (ev) {
    this.pending.push(ev)
    if (this.pending.length > this.liveBatch * 4) this.pending.splice(0, this.pending.length - this.liveBatch * 2)
  }

  startFlushTimer () {
    this._flushTimer = setInterval(() => {
      if (!this.pending.length || !this.clients.size) { this.pending.length = 0; return }
      const batch = this.pending.length > this.liveBatch ? this.pending.slice(-this.liveBatch) : this.pending.slice()
      const dropped = this.pending.length - batch.length
      this.pending.length = 0
      this.broadcast({ type: 'logs', events: batch, dropped })
    }, 200)
  }
}

module.exports = SseHub
