'use strict'

const http = require('http')
const path = require('path')
const { execSync } = require('child_process')
const LineSplitter = require('../shared/LineSplitter')
const { HOST } = require('../shared/config')

function getPgid (pid) {
  try { return execSync('ps -o pgid= -p ' + pid, { encoding: 'utf8' }).trim() } catch (e) { return null }
}

function ingestPath (name) {
  const pgid = getPgid(process.pid)
  return '/ingest?name=' + encodeURIComponent(name) + '&pid=' + process.pid + (pgid ? '&pgid=' + pgid : '')
}

function streamNameFromArgs (args) {
  const named = args.find((a) => a && !a.startsWith('-'))
  if (named) return named
  return path.basename(process.cwd()) || 'stream'
}

function pipeToDaemon (name, source, port) {
  let req = null
  let up = false
  function open () {
    req = http.request({
      host: HOST, port, path: ingestPath(name),
      method: 'POST', headers: { 'Content-Type': 'text/plain' }
    }, (res) => { res.resume() })
    req.on('error', () => { up = false; setTimeout(open, 1000) })
    up = true
  }
  open()
  const splitter = new LineSplitter((line) => {
    process.stdout.write(line + '\n')
    if (up && req) { try { req.write(line + '\n') } catch (e) {} }
  })
  source.setEncoding('utf8')
  source.on('data', (c) => splitter.push(c))
  source.on('end', () => { splitter.end(); try { if (req) req.end() } catch (e) {} })
  source.on('error', () => { try { if (req) req.end() } catch (e) {} })
}

module.exports = { getPgid, ingestPath, streamNameFromArgs, pipeToDaemon }
