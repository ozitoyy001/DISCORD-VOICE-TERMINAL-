'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/logger');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dvt-log-'));
const FAKE_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAA.BBBBBB.CCCCCCCCCCCCCCCCCCCCCCCCCCCC';

test('le journal masque les secrets enregistres, les tokens et les webhooks', () => {
  const log = createLogger();
  log.registerSecret('mon-secret-perso-123');
  log.error('x mon-secret-perso-123 y');
  log.error('token ' + FAKE_TOKEN);
  log.error('hook https://discord.com/api/webhooks/123456/abcDEF-ghi_jkl');
  const all = log.entries.join('\n');
  assert.ok(!all.includes('mon-secret-perso-123'));
  assert.ok(!all.includes(FAKE_TOKEN));
  assert.ok(!all.includes('abcDEF-ghi_jkl'));
  assert.equal((all.match(/\[REDACTED\]/g) || []).length, 3);
});

test('le fichier de journal est cree en 0600 (POSIX) et ne contient pas de secret', { skip: process.platform === 'win32' }, () => {
  const dir = tmp(); const file = path.join(dir, 'sub', 'dvt.log');
  const log = createLogger();
  log.setFile(file);
  log.error('secret ' + FAKE_TOKEN);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(FAKE_TOKEN));
});

test("un ancien journal en 0644 est remis en 0600", { skip: process.platform === 'win32' }, () => {
  const dir = tmp(); const file = path.join(dir, 'dvt.log');
  fs.writeFileSync(file, 'ancien\n', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  createLogger().setFile(file);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('rotation : au-dela de maxBytes le journal passe en .1', () => {
  const dir = tmp(); const file = path.join(dir, 'dvt.log');
  const log = createLogger({ maxBytes: 500 });
  log.setFile(file);
  for (let i = 0; i < 30; i++) log.info('ligne numero ' + i + ' ' + 'x'.repeat(30));
  assert.ok(fs.existsSync(file + '.1'), 'fichier .1 attendu');
  assert.ok(fs.statSync(file).size < 1500, 'le journal courant doit rester petit');
});

test('entries est borne a maxEntries', () => {
  const log = createLogger({ maxEntries: 5 });
  for (let i = 0; i < 20; i++) log.info('m' + i);
  assert.equal(log.entries.length, 5);
  assert.match(log.entries[4], /m19$/);
});
