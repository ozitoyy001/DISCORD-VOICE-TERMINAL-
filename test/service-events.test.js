'use strict';
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const Module = require('node:module');

// Faux client discord.js : permet de tester la machine a etats sans reseau.
class FakeClient extends EventEmitter {
  constructor() { super(); this._ready = false; this.user = { username: 'bot' }; this.guilds = { cache: new Map() }; }
  async login() { setTimeout(() => { this._ready = true; }, 5); }
  isReady() { return this._ready; }
  async destroy() {}
}

function loadServiceWithFakeClient() {
  const real = require('discord.js');
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    const m = origLoad.call(this, req, ...rest);
    return req === 'discord.js' ? { ...real, Client: FakeClient } : m;
  };
  const key = require.resolve('../src/discord/service');
  delete require.cache[key];
  try { return require('../src/discord/service').DiscordService; }
  finally { Module._load = origLoad; delete require.cache[key]; }
}

const log = { info() {}, warn() {}, error() {} };

test('shardDisconnect puis shardReady => retour a CONNECTED', async () => {
  const DiscordService = loadServiceWithFakeClient();
  const d = new DiscordService(log);
  await d.connect('x');
  assert.equal(d.state, 'CONNECTED');
  d.client.emit('shardDisconnect');
  assert.equal(d.state, 'DISCONNECTED');
  d.client.emit('shardReady');
  assert.equal(d.state, 'CONNECTED');
  await d.disconnect();
  assert.equal(d.state, 'DISCONNECTED');
});

test('shardDisconnect puis shardResume => retour a CONNECTED', async () => {
  const DiscordService = loadServiceWithFakeClient();
  const d = new DiscordService(log);
  await d.connect('x');
  d.client.emit('shardDisconnect');
  d.client.emit('shardResume');
  assert.equal(d.state, 'CONNECTED');
  await d.disconnect();
});
