'use strict';

class AppError extends Error {
  constructor(message, alert = false) {
    super(message);
    this.alert = alert;
  }
}

// Erreur -> texte sur une seule ligne (message + debut de la stack), pour le journal.
// Les secrets sont retires ensuite par le logger (redact).
function describe(e, max = 700) {
  if (e == null) return 'unknown error';
  const raw = e instanceof Error ? (e.stack || e.message) : String(e);
  const one = raw.replace(/\s*\n\s*/g, ' | ');
  return one.length > max ? one.slice(0, max - 3) + '...' : one;
}

module.exports = { AppError, describe };
