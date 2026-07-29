'use strict'

const http = require('http')
const { HOST } = require('./config')

function healthCheck (port) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/health', timeout: 800 }, (res) => {
      let d = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { d += c })
      res.on('end', () => resolve(res.statusCode === 200 && d.includes('"ok":true')))
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

module.exports = { healthCheck }
