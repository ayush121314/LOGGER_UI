'use strict'

const IST_MS = 5.5 * 3600 * 1000

function dayOf (ts) {
  return new Date(ts + IST_MS).toISOString().slice(0, 10)
}

module.exports = { IST_MS, dayOf }
