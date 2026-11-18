'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// config.js calcule son dossier au chargement : on le recharge pour chaque test avec un dossier jetable.
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvt-cfg-'));
  process.env.DVT_CONFIG_DIR = dir;
  const key = require.resolve('../src/config');
  delete require.cache[key];
  return { dir, config: require('../src/config') };
}

test('valeurs par defaut si aucun fichier', () => {
  const { config } = fresh();
  const c = config.loadConfig();
  assert.equal(c.mode, 'MIC'); assert.equal(c.audio.volume, 100); assert.equal(c.guildId, null);
});

test('fusion partielle et bornage (volume, vitesse, mode)', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'config.json'),
    JSON.stringify({ mode: 'bidon', audio: { volume: 999 }, tts: { speed: 1 } }));
  const c = config.loadConfig();
  assert.equal(c.mode, 'MIC'); assert.equal(c.audio.volume, 200); assert.equal(c.tts.speed, 80);
  assert.equal(c.audio.inputDevice, 'default'); // cle absente => defaut
});

test('mauvais types ignores (retour au defaut)', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'config.json'),
    JSON.stringify({ audio: 'oups', tts: { language: 42, speed: 'vite' }, webhook: { enabled: 'oui' } }));
  const c = config.loadConfig();
  assert.equal(c.tts.language, 'fr'); assert.equal(c.webhook.enabled, false); assert.equal(c.audio.volume, 100);
});

test('guildId / channelId : seulement des identifiants numeriques', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ guildId: 'abc', channelId: '123456789012345678' }));
  const c = config.loadConfig();
  assert.equal(c.guildId, null); assert.equal(c.channelId, '123456789012345678');
});

test('__proto__ et constructor dans le JSON ne polluent rien', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'config.json'),
    '{"__proto__":{"polluted":true},"constructor":{"x":1},"audio":{"__proto__":{"polluted2":true}}}');
  const c = config.loadConfig();
  assert.equal(({}).polluted, undefined);
  assert.equal(c.polluted, undefined); assert.equal(c.audio.polluted2, undefined);
  assert.equal(Object.getPrototypeOf(c), Object.prototype);
});

test('JSON corrompu : mis de cote (.corrupt-*), defauts utilises, rien d\'ecrase', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'config.json'), '{ pas du json');
  const c = config.loadConfig();
  assert.equal(c.mode, 'MIC');
  const saved = fs.readdirSync(dir).filter((f) => f.startsWith('config.json.corrupt-'));
  assert.equal(saved.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, saved[0]), 'utf8'), '{ pas du json');
});

test('secrets : set/get/delete, fichier en 0600 (POSIX)', () => {
  const { dir, config } = fresh();
  config.setSecret('token', 'x'.repeat(40));
  assert.equal(config.getSecret('token'), 'x'.repeat(40));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secrets.json')).mode & 0o777, 0o600);
  config.deleteSecret('token');
  assert.equal(config.getSecret('token'), null);
});

test('secrets.json corrompu n\'est pas ecrase silencieusement', () => {
  const { dir, config } = fresh();
  fs.writeFileSync(path.join(dir, 'secrets.json'), 'garbage');
  assert.equal(config.getSecret('token'), null);
  config.setSecret('webhookUrl', 'https://discord.com/api/webhooks/1/a');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('secrets.json.corrupt-')));
});

test('getToken : la variable d\'environnement est prioritaire', () => {
  const { config } = fresh();
  config.setSecret('token', 'fichier'.repeat(6));
  process.env.DISCORD_BOT_TOKEN = '  envtoken  ';
  try {
    const t = config.getToken();
    assert.deepEqual(t, { value: 'envtoken', source: 'env' });
  } finally { delete process.env.DISCORD_BOT_TOKEN; }
  assert.equal(config.getToken().source, 'file');
});

test('saveConfig puis loadConfig : aller-retour', () => {
  const { config } = fresh();
  const c = config.loadConfig(); c.audio.volume = 150; c.tts.language = 'en';
  config.saveConfig(c);
  const d = config.loadConfig();
  assert.equal(d.audio.volume, 150); assert.equal(d.tts.language, 'en');
});
