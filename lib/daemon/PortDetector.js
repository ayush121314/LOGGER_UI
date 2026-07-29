'use strict'

const { exec } = require('child_process')

class PortDetector {
  detect (opts) {
    const { pgid, clientPid, excludePort, isActive, onFound } = opts
    if (!pgid) return
    let tries = 0
    const timer = setInterval(() => {
      tries++
      if (tries > 20) { clearInterval(timer); return }
      if (!isActive()) { clearInterval(timer); return }
      exec('ps -ax -o pid=,ppid=,pgid=', (e, psout) => {
        if (e || !psout) return
        const childrenOf = new Map()
        const pgidOf = new Map()
        psout.split('\n').forEach((line) => {
          const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/)
          if (!m) return
          pgidOf.set(m[1], m[3])
          if (!childrenOf.has(m[2])) childrenOf.set(m[2], [])
          childrenOf.get(m[2]).push(m[1])
        })
        const allowed = new Set()
        const stack = []
        pgidOf.forEach((pg, pid) => { if (pg === String(pgid)) { allowed.add(pid); stack.push(pid) } })
        while (stack.length) {
          const pid = stack.pop()
          ;(childrenOf.get(pid) || []).forEach((k) => { if (!allowed.has(k)) { allowed.add(k); stack.push(k) } })
        }
        exec('lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null', (e2, lout) => {
          if (e2 || !lout) return
          let cur = null
          let found = null
          lout.split('\n').forEach((line) => {
            if (line[0] === 'p') cur = line.slice(1)
            else if (line[0] === 'n') {
              const m = line.slice(1).match(/:(\d+)$/)
              if (m && cur && allowed.has(cur) && cur !== String(clientPid) && m[1] !== String(excludePort) && !found) found = m[1]
            }
          })
          if (found) {
            if (isActive()) onFound(found)
            clearInterval(timer)
          }
        })
      })
    }, 1500)
  }
}

module.exports = PortDetector
