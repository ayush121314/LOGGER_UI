'use strict'

class LineSplitter {
  constructor (onLine) {
    this.buf = ''
    this.onLine = onLine
  }

  push (chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx)
      this.buf = this.buf.slice(idx + 1)
      this.onLine(line)
    }
  }

  end () {
    if (this.buf.length) { this.onLine(this.buf); this.buf = '' }
  }
}

module.exports = LineSplitter
