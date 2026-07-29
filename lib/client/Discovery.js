'use strict'

const { PREFERRED_PORT } = require('../shared/config')
const { readPortFile } = require('../shared/paths')
const { healthCheck } = require('../shared/health')
const { spawnDaemon } = require('./Launcher')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function discoverDaemon () {
  if (await healthCheck(PREFERRED_PORT)) return { port: PREFERRED_PORT, spawned: false }
  const pf = readPortFile()
  if (pf && pf !== PREFERRED_PORT && await healthCheck(pf)) return { port: pf, spawned: false }
  spawnDaemon()
  for (let i = 0; i < 60; i++) {
    await sleep(150)
    const p = readPortFile()
    if (p && await healthCheck(p)) return { port: p, spawned: true }
  }
  return { port: 0, spawned: false }
}

module.exports = { discoverDaemon }
