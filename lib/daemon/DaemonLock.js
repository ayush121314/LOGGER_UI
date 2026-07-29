'use strict'

const fs = require('fs')
const { LOCK_FILE } = require('../shared/paths')

class DaemonLock {
  acquire () {
    try { fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' }); return true } catch (e) { return false }
  }

  release () {
    try { fs.unlinkSync(LOCK_FILE) } catch (e) {}
  }
}

module.exports = DaemonLock
