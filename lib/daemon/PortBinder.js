'use strict'

const { HOST } = require('../shared/config')
const { healthCheck } = require('../shared/health')

function tryListen (server, p) {
  return new Promise((resolve) => {
    const onErr = () => { server.removeListener('error', onErr); resolve(0) }
    server.once('error', onErr)
    server.listen(p, HOST, () => { server.removeListener('error', onErr); resolve(server.address().port) })
  })
}

async function chooseAndListen (server, candidates) {
  for (const p of candidates) {
    if (p !== 0 && await healthCheck(p)) return { existing: p }
    const bound = await tryListen(server, p)
    if (bound) return { port: bound }
  }
  return {}
}

module.exports = { chooseAndListen, tryListen }
