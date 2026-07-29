#!/usr/bin/env node
'use strict'

const { run } = require('../lib/Cli')

Promise.resolve(run(process.argv.slice(2))).catch((e) => {
  process.stderr.write('[logapp] ' + (e && e.stack ? e.stack : e) + '\n')
  process.exit(1)
})
