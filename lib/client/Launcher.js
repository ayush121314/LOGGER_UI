'use strict'

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { DAEMON_LOG, ensureStateDir } = require('../shared/paths')
const { ensureInstalled } = require('../shared/install')

const LOCAL_BIN = path.join(__dirname, '..', '..', 'bin', 'logapp.js')

function spawnDaemon () {
  ensureStateDir()
  const bin = ensureInstalled() || LOCAL_BIN
  const out = fs.openSync(DAEMON_LOG, 'a')
  const child = spawn(process.execPath, [bin, '--daemon'], { detached: true, stdio: ['ignore', out, out] })
  child.unref()
}

function openBrowser (url) {
  try {
    const cmd = process.platform === 'darwin' ? 'open' : (process.platform === 'win32' ? 'start' : 'xdg-open')
    spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {}
}

module.exports = { spawnDaemon, openBrowser }
