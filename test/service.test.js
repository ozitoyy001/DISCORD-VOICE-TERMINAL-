'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DiscordService } = require('../src/discord/service');

const log = { info() {}, warn() {}, error() {} };

test('setPlayer memorise le lecteur (utilise ensuite par join)', () => {
  const svc = new DiscordService(log);
  const player = {};
  svc.setPlayer(player);
  assert.equal(svc.player, player);
});

test('setPlayer abonne une connexion vocale deja ouverte', () => {
  const svc = new DiscordService(log);
  const calls = [];
  svc.connection = { subscribe: (p) => calls.push(p) };
  const player = {};
  svc.setPlayer(player);
  assert.deepEqual(calls, [player]);
});

test('setPlayer sans connexion ne plante pas', () => {
  const svc = new DiscordService(log);
  assert.doesNotThrow(() => svc.setPlayer({}));
});
