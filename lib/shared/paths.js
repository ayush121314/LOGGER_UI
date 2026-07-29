'use strict'

const os = require('os')
const path = require('path')
const fs = require('fs')

const STATE_DIR = path.join(os.homedir(), '.logapp')
const PORT_FILE = path.join(STATE_DIR, 'daemon.port')
const PID_FILE = path.join(STATE_DIR, 'daemon.pid')
const LOCK_FILE = path.join(STATE_DIR, 'daemon.lock')
const DAEMON_LOG = path.join(STATE_DIR, 'daemon.log')
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public')

function ensureStateDir () {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }) } catch (e) {}
}

function readPortFile () {
  try { return Number(fs.readFileSync(PORT_FILE, 'utf8').trim()) || 0 } catch (e) { return 0 }
}

module.exports = { STATE_DIR, PORT_FILE, PID_FILE, LOCK_FILE, DAEMON_LOG, PUBLIC_DIR, ensureStateDir, readPortFile }
