'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { post, Notifier } = require('../src/notify/webhook');

const URL_OK = 'https://discord.com/api/webhooks/123456/abcDEF';
const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('post : succes simple, contenu limite et sans mention', async () => {
  let seen;
  await post(URL_OK, 'ERROR', 'AUDIO_PLAYER_FAILED', { fetchImpl: async (u, init) => { seen = { u, init }; return resp(204); } });
  const body = JSON.parse(seen.init.body);
  assert.equal(body.content, '[DVT] ERROR AUDIO_PLAYER_FAILED');
  assert.deepEqual(body.allowed_mentions, { parse: [] });
});

test('post : refuse URL invalide et evenement hors liste', async () => {
  await assert.rejects(post('https://example.com/x', 'ERROR'), /invalid webhook URL/);
  await assert.rejects(post(URL_OK, 'TEXTE_LIBRE'), /event not allowed/);
});

test('post : 429 avec retry_after court => attend puis reussit', async () => {
  const answers = [resp(429, { retry_after: 0.5 }), resp(204)];
  const waits = [];
  await post(URL_OK, 'TEST', undefined, { fetchImpl: async () => answers.shift(), sleepFn: async (ms) => waits.push(ms) });
  assert.deepEqual(waits, [500]); assert.equal(answers.length, 0);
});

test('post : 429 avec retry_after trop long ou illisible => erreur', async () => {
  await assert.rejects(post(URL_OK, 'TEST', undefined, { fetchImpl: async () => resp(429, { retry_after: 60 }) }), /rate limited/);
  await assert.rejects(post(URL_OK, 'TEST', undefined, { fetchImpl: async () => ({ status: 429, ok: false, json: async () => { throw new Error('x'); } }) }), /rate limited/);
});

test('post : deux 429 de suite => erreur (une seule relance)', async () => {
  let n = 0;
  await assert.rejects(post(URL_OK, 'TEST', undefined, { fetchImpl: async () => { n++; return resp(429, { retry_after: 1 }); }, sleepFn: async () => {} }), /rate limited/);
  assert.equal(n, 2);
});

test('post : autre erreur HTTP', async () => {
  await assert.rejects(post(URL_OK, 'TEST', undefined, { fetchImpl: async () => resp(500) }), /HTTP 500/);
});

test('Notifier : inactif si desactive ou URL absente', () => {
  const log = { warn() {} };
  assert.equal(new Notifier(log, () => URL_OK, () => false).active(), false);
  assert.equal(new Notifier(log, () => null, () => true).active(), false);
  assert.equal(new Notifier(log, () => URL_OK, () => true).active(), true);
});
