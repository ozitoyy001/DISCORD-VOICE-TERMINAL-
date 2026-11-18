'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { App } = require('../src/ui/app');
const { AppError } = require('../src/util/errors');

function fakeApp({ connected, voice }) {
  const calls = [];
  const app = Object.create(App.prototype);
  Object.assign(app, {
    closing: false,
    log: { error: (m) => calls.push('log:' + m) },
    rl: { close: () => calls.push('rl.close') },
    audio: { stop: () => calls.push('audio.stop'), dispose: () => calls.push('audio.dispose') },
    discord: {
      state: connected ? 'CONNECTED' : 'DISCONNECTED',
      connection: voice ? {} : null,
      leave: () => calls.push('leave'),
      disconnect: async () => calls.push('disconnect')
    },
    notifier: { notifyNow: async (e) => { calls.push('alert:' + e); } }
  });
  return { app, calls };
}

async function runQuit(app, code) {
  const realExit = process.exit; const realWrite = process.stdout.write;
  let exitCode = null;
  process.exit = (c) => { exitCode = c; };
  process.stdout.write = () => true;
  try { await app.quit(code); } finally { process.exit = realExit; process.stdout.write = realWrite; }
  return exitCode;
}

test('quit : envoie VOICE_LEFT et DISCONNECTED avant de sortir, code 0', async () => {
  const { app, calls } = fakeApp({ connected: true, voice: true });
  const code = await runQuit(app);
  assert.equal(code, 0);
  assert.ok(calls.includes('alert:VOICE_LEFT'));
  assert.ok(calls.includes('alert:DISCONNECTED'));
  assert.ok(calls.indexOf('alert:VOICE_LEFT') < calls.indexOf('disconnect'));
});

test('quit : pas d\'alerte VOICE_LEFT si aucun salon rejoint', async () => {
  const { app, calls } = fakeApp({ connected: true, voice: false });
  await runQuit(app);
  assert.ok(!calls.includes('alert:VOICE_LEFT'));
  assert.ok(calls.includes('alert:DISCONNECTED'));
});

test('quit(1) propage le code de sortie, et un second quit est ignore', async () => {
  const { app } = fakeApp({ connected: false, voice: false });
  assert.equal(await runQuit(app, 1), 1);
  assert.equal(await runQuit(app, 0), null); // closing deja vrai : aucun exit supplementaire
});

test('report : erreur AppError.alert declenche une alerte ERROR avec code', () => {
  const app = Object.create(App.prototype);
  const sent = [];
  Object.assign(app, { log: { error() {} }, notifier: { notify: (e, c) => sent.push([e, c]) }, level: '', status: '' });
  app.report(new AppError('permission', true), 'VOICE_JOIN_FAILED');
  app.report(new AppError('simple', false), 'AUDIO_START_FAILED');
  assert.deepEqual(sent, [['ERROR', 'VOICE_JOIN_FAILED']]);
});
