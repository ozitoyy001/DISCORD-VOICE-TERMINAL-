'use strict';
const fs = require('fs');
const path = require('path');
const { ascii } = require('./util/ascii');

const MAX = 200;
const entries = [];
const secrets = new Set();
let logFile = null;

function registerSecret(v) {
  if (v && String(v).length >= 8) secrets.add(String(v));
}

function redact(text) {
  let s = String(text);
  for (const v of secrets) s = s.split(v).join('[REDACTED]');
  s = s.replace(/[\w-]{20,}\.[\w-]{5,8}\.[\w-]{25,}/g, '[REDACTED]');
  s = s.replace(/(discord(?:app)?\.com\/api\/webhooks\/)\d+\/[\w-]+/gi, '$1[REDACTED]');
  return s;
}

function setFile(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  logFile = p;
}

function write(level, msg) {
  const line = redact(ascii(msg));
  entries.push(new Date().toISOString().slice(11, 19) + ' ' + level.padEnd(5) + ' ' + line);
  if (entries.length > MAX) entries.shift();
  if (logFile) {
    try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + level + ' ' + line + '\n'); }
    catch (_) { /* journal indisponible : on continue */ }
  }
}

module.exports = {
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
  registerSecret,
  setFile,
  entries
};
