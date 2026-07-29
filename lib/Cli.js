'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')
const { HOST } = require('./shared/config')
const { PORT_FILE, PID_FILE, LOCK_FILE } = require('./shared/paths')
const Daemon = require('./daemon/Daemon')
const { discoverDaemon } = require('./client/Discovery')
const { openBrowser } = require('./client/Launcher')
const { ingestPath, streamNameFromArgs, pipeToDaemon } = require('./client/PipeClient')

const ALIAS_MARKER = '# >>> logapp >>>'

function installAlias () {
  const viaNpx = __dirname.includes('/_npx/') || __dirname.includes('/.npm/_npx/')
  if (viaNpx) {
    process.stdout.write('logapp: install globally first, then add the shortcut:\n  npm install -g logapp-ui\n  logapp --install-alias\n')
    return
  }
  const rc = path.join(os.homedir(), '.zshrc')
  let existing = ''
  try { existing = fs.readFileSync(rc, 'utf8') } catch (e) {}
  if (existing.includes(ALIAS_MARKER)) {
    process.stdout.write('logapp: the --logapp shortcut is already in ~/.zshrc\n')
  } else {
    const block = '\n' + ALIAS_MARKER + '\n' + "alias -g -- --logapp='| logapp'\n" + '# <<< logapp <<<\n'
    try { fs.appendFileSync(rc, block) } catch (e) { process.stderr.write('logapp: could not write ~/.zshrc: ' + e.message + '\n'); return }
    process.stdout.write('logapp: added the --logapp shortcut to ~/.zshrc\n')
  }
  process.stdout.write('Run:  source ~/.zshrc   (or open a new terminal)\n')
  process.stdout.write('Then append --logapp to any command:  npm start --logapp\n')
}

async function run (argv) {
  if (argv[0] === '--daemon') { new Daemon().start(); return }

  if (argv[0] === '--install-alias' || argv[0] === 'setup') { installAlias(); return }

  if (argv[0] === '--stop') {
    try {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
      process.kill(pid)
      process.stdout.write('logapp daemon stopped (pid ' + pid + ')\n')
    } catch (e) { process.stdout.write('logapp daemon not running\n') }
    try { fs.unlinkSync(PORT_FILE) } catch (e) {}
    try { fs.unlinkSync(LOCK_FILE) } catch (e) {}
    return
  }

  const dstate = await discoverDaemon()
  if (!dstate.port) { process.stderr.write('[logapp] could not start daemon\n'); process.exit(1) }
  const url = 'http://localhost:' + dstate.port

  const wrapperIdx = argv.indexOf('--')
  if (wrapperIdx !== -1) {
    const cmdParts = argv.slice(wrapperIdx + 1)
    const name = streamNameFromArgs(argv.slice(0, wrapperIdx))
    const shell = process.env.SHELL || '/bin/sh'
    const child = spawn(shell, ['-c', cmdParts.join(' ')], { stdio: ['inherit', 'pipe', 'pipe'] })
    const req = http.request({
      host: HOST, port: dstate.port, path: ingestPath(name),
      method: 'POST', headers: { 'Content-Type': 'text/plain' }
    }, (res) => { res.resume() })
    req.on('error', () => {})
    const forward = (chunk, toErr) => {
      (toErr ? process.stderr : process.stdout).write(chunk)
      try { req.write(chunk) } catch (e) {}
    }
    child.stdout.on('data', (c) => forward(c, false))
    child.stderr.on('data', (c) => forward(c, true))
    child.on('close', (code) => { try { req.end() } catch (e) {} process.exit(code || 0) })
    if (dstate.spawned) openBrowser(url)
    process.stderr.write('[logapp] streaming "' + name + '" -> ' + url + '\n')
    return
  }

  if (!process.stdin.isTTY) {
    const name = streamNameFromArgs(argv)
    if (dstate.spawned) openBrowser(url)
    process.stderr.write('[logapp] streaming "' + name + '" -> ' + url + '\n')
    pipeToDaemon(name, process.stdin, dstate.port)
    return
  }

  process.stdout.write('logapp UI ready -> ' + url + '\n')
  openBrowser(url)
}

module.exports = { run }
