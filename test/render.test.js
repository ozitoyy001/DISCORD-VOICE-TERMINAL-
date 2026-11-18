'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { frame } = require('../src/ui/render');
const { ascii, pad } = require('../src/util/ascii');

test('frame : toutes les lignes font 60 colonnes, ASCII pur', () => {
  const out = frame({
    header: ['Bot    : CONNECTED', 'Voice  : ' + 'tres long '.repeat(20), 'Nom accentue : cafe\u0301 \u2713 \u{1F600}'],
    body: ['[1] Connection', 'x'.repeat(200)],
    level: 'READY', status: 'Ready'
  });
  const lines = out.split('\n');
  for (const l of lines) assert.equal(l.length, 60, 'ligne de largeur incorrecte : ' + JSON.stringify(l));
  assert.ok(/^[\x20-\x7E\n]+$/.test(out), 'caracteres non ASCII dans le rendu');
  assert.ok(out.includes('DISCORD VOICE TERMINAL'));
});

test('ascii : null/undefined, accents, emojis, limite', () => {
  assert.equal(ascii(null), ''); assert.equal(ascii(undefined), '');
  assert.equal(ascii('\u00e9t\u00e9'), 'ete');
  assert.equal(ascii('\u{1F600}'), '?');
  assert.equal(ascii('abcdefghij', 6), 'abc...');
  assert.equal(pad('x', 3), 'x  ');
});
