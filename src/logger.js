'use strict';
const fs = require('fs');
const path = require('path');
const { ascii } = require('./util/ascii');

// Fabrique de logger : un exemplaire par defaut est exporte (module.exports),
// createLogger() sert aux tests.
function createLogger({ maxEntries = 200, maxBytes = 1024 * 1024 } = {}) {
  const entries = [];
  const secrets = new Set();
  let logFile = null;
  let fileSize = 0;

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

  // Au-dela de maxBytes, le journal courant devient <fichier>.1 (l'ancien .1 est ecrase).
  function rotateIfNeeded() {
    if (!logFile || fileSize < maxBytes) return;
    try {
      fs.renameSync(logFile, logFile + '.1');
      fs.chmodSync(logFile + '.1', 0o600);
    } catch (_) { /* rotation impossible : on continue d'ecrire */ }
    fileSize = 0;
  }

  function setFile(p) {
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    logFile = p;
    try {
      fileSize = fs.statSync(p).size;
      fs.chmodSync(p, 0o600); // corrige un ancien journal cree en 0644
    } catch (_) { fileSize = 0; }
    rotateIfNeeded();
  }

  function write(level, msg) {
    const line = redact(ascii(msg));
    entries.push(new Date().toISOString().slice(11, 19) + ' ' + level.padEnd(5) + ' ' + line);
    if (entries.length > maxEntries) entries.shift();
    if (logFile) {
      const out = new Date().toISOString() + ' ' + level + ' ' + line + '\n';
      try {
        rotateIfNeeded();
        fs.appendFileSync(logFile, out, { mode: 0o600 });
        fileSize += Buffer.byteLength(out);
      } catch (_) { /* journal indisponible : on continue */ }
    }
  }

  return {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    registerSecret,
    setFile,
    entries,
    createLogger
  };
}

module.exports = createLogger();
