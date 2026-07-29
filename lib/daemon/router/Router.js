'use strict'

class Router {
  constructor () { this.routes = [] }

  register (method, pathname, handler) {
    const matcher = typeof pathname === 'function' ? pathname : (pn) => pn === pathname
    this.routes.push({ method, matcher, handler })
    return this
  }

  get (pathname, handler) { return this.register('GET', pathname, handler) }
  post (pathname, handler) { return this.register('POST', pathname, handler) }

  handle (req, res, url) {
    for (const r of this.routes) {
      if (req.method === r.method && r.matcher(url.pathname)) { r.handler(req, res, url); return true }
    }
    return false
  }
}

module.exports = Router
