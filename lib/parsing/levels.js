'use strict'

function normalizeLevel (lvl) {
  if (lvl === undefined || lvl === null) return 'info'
  if (typeof lvl === 'number') {
    if (lvl >= 60) return 'fatal'
    if (lvl >= 50) return 'error'
    if (lvl >= 40) return 'warn'
    if (lvl >= 30) return 'info'
    if (lvl >= 20) return 'debug'
    return 'trace'
  }
  const s = String(lvl).toLowerCase()
  if (['trace', 'debug', 'info', 'warn', 'warning', 'error', 'fatal'].includes(s)) {
    return s === 'warning' ? 'warn' : s
  }
  return 'info'
}

function guessLevel (line) {
  const l = line.toLowerCase()
  if (/\b(fatal|panic)\b/.test(l)) return 'fatal'
  if (/(error|err!|exception|unhandled|fail(ed|ure)?)/.test(l)) return 'error'
  if (/\bwarn(ing)?\b/.test(l)) return 'warn'
  if (/\bdebug\b/.test(l)) return 'debug'
  return 'info'
}

module.exports = { normalizeLevel, guessLevel }
