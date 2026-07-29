'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { APP_DIR, INSTALLED_BIN, PACKAGE_ROOT } = require('./paths')

const MARKER = '# >>> logapp >>>'

function isInstalledCopy () {
  return __dirname.startsWith(APP_DIR)
}

// Copy the package into a stable location (~/.logapp/app) so the daemon never
// depends on an ephemeral npx cache. Returns the stable bin path, or null on failure.
function ensureInstalled () {
  if (isInstalledCopy()) return INSTALLED_BIN
  if (fs.existsSync(INSTALLED_BIN)) return INSTALLED_BIN
  try {
    fs.mkdirSync(APP_DIR, { recursive: true })
    for (const sub of ['bin', 'lib', 'public']) {
      const src = path.join(PACKAGE_ROOT, sub)
      if (fs.existsSync(src)) fs.cpSync(src, path.join(APP_DIR, sub), { recursive: true })
    }
    try { fs.copyFileSync(path.join(PACKAGE_ROOT, 'package.json'), path.join(APP_DIR, 'package.json')) } catch (e) {}
    return fs.existsSync(INSTALLED_BIN) ? INSTALLED_BIN : null
  } catch (e) { return null }
}

// Add the `logapp` command alias (pointing at the stable copy) and the `--logapp`
// zsh global alias to ~/.zshrc. Idempotent. Returns 'added' | 'exists' | 'error'.
function installAliases () {
  const rc = path.join(os.homedir(), '.zshrc')
  let existing = ''
  try { existing = fs.readFileSync(rc, 'utf8') } catch (e) {}
  if (existing.includes(MARKER)) return 'exists'
  const block = '\n' + MARKER + '\n' +
    'alias logapp=\'node "$HOME/.logapp/app/bin/logapp.js"\'\n' +
    "alias -g -- --logapp='| logapp'\n" +
    '# <<< logapp <<<\n'
  try { fs.appendFileSync(rc, block); return 'added' } catch (e) { return 'error' }
}

module.exports = { ensureInstalled, installAliases, isInstalledCopy }
