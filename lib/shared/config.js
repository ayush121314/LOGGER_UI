'use strict'

const os = require('os')
const path = require('path')

module.exports = {
  HOST: '127.0.0.1',
  PREFERRED_PORT: Number(process.env.LOGAPP_PORT || 9999),
  LOGS_DIR: process.env.LOGAPP_LOGS_DIR || path.join(os.homedir(), 'Downloads', 'logapp-logs'),
  MAX_BUFFER: Number(process.env.LOGAPP_BUFFER) || 20000,
  SNAPSHOT_LIMIT: Number(process.env.LOGAPP_SNAPSHOT) || 4000,
  LIVE_BATCH: Number(process.env.LOGAPP_LIVE_BATCH) || 400,
  PERSIST: process.env.LOGAPP_PERSIST !== '0',
  MAX_FILE_BYTES: (Number(process.env.LOGAPP_MAX_FILE_MB) || 2048) * 1024 * 1024,
  RETAIN_MS: (Number(process.env.LOGAPP_RETAIN_DAYS) || 7) * 86400000,
  WRITE_BACKPRESSURE_BYTES: 8 * 1024 * 1024,
  PALETTE: ['#4C9AFF', '#57D9A3', '#FFAB00', '#FF5630', '#B37FEB', '#00C7E6', '#F76707', '#20C997', '#845EF7', '#FF8787', '#38D9A9', '#FCC419']
}
