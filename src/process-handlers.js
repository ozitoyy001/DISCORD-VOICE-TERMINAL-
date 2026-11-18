'use strict';
const { describe } = require('./util/errors');

// Installe les gestionnaires de signaux et d'erreurs globales.
//  - SIGTERM / SIGHUP       : arret propre (quit(0))
//  - uncaughtException      : journalise puis arret propre (quit(1))
//  - unhandledRejection     : journalise et affiche ERROR, l'application continue
//  - exit                   : dernier filet, tue ffmpeg / espeak-ng restants (synchrone)
function installProcessHandlers(proc, { log, quit, soft, cleanup }) {
  for (const sig of ['SIGTERM', 'SIGHUP']) {
    proc.on(sig, () => { log.warn('signal ' + sig + ' received'); quit(0); });
  }
  proc.on('uncaughtException', (e) => {
    log.error('uncaught exception: ' + describe(e));
    quit(1);
  });
  proc.on('unhandledRejection', (r) => {
    log.error('unhandled rejection: ' + describe(r));
    if (soft) soft('unexpected error (see Logs)');
  });
  proc.on('exit', () => { try { if (cleanup) cleanup(); } catch (_) { /* rien a faire */ } });
}

module.exports = { installProcessHandlers };
