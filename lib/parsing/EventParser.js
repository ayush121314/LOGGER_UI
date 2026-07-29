'use strict'

const { normalizeLevel, guessLevel } = require('./levels')

class JsonLineStrategy {
  parse (trimmed) {
    if (!(trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}')) return null
    let obj
    try { obj = JSON.parse(trimmed) } catch (e) { return null }
    return {
      level: normalizeLevel(obj.level),
      ts: typeof obj.time === 'number' ? obj.time : (Date.parse(obj.time) || Date.now()),
      msg: obj.msg || obj.message || obj.event || '',
      fields: obj
    }
  }
}

class PlainLineStrategy {
  parse (trimmed) {
    return { level: guessLevel(trimmed), ts: Date.now(), msg: trimmed, fields: null }
  }
}

class EventParser {
  constructor (strategies) {
    this.strategies = strategies || [new JsonLineStrategy(), new PlainLineStrategy()]
  }

  parse (line, streamName) {
    const trimmed = line.replace(/\s+$/, '')
    if (trimmed.trim() === '') return null
    for (const strategy of this.strategies) {
      const r = strategy.parse(trimmed)
      if (r) return { stream: streamName, level: r.level, ts: r.ts, msg: String(r.msg), raw: trimmed, fields: r.fields }
    }
    return null
  }
}

module.exports = { EventParser, JsonLineStrategy, PlainLineStrategy }
