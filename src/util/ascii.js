'use strict';

function ascii(value, max) {
  let s = String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/gu, '?');
  if (max && s.length > max) s = s.slice(0, Math.max(0, max - 3)) + '...';
  return s;
}

function pad(value, n) {
  const s = ascii(value, n);
  return s + ' '.repeat(Math.max(0, n - s.length));
}

module.exports = { ascii, pad };
