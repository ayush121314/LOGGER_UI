'use strict'

class RingBuffer {
  constructor (max) {
    this.max = max
    this.items = []
  }

  push (ev) {
    this.items.push(ev)
    if (this.items.length > this.max * 1.3) {
      this.items.splice(0, this.items.length - this.max)
    }
  }

  recent (n) {
    return this.items.slice(-n)
  }
}

module.exports = RingBuffer
