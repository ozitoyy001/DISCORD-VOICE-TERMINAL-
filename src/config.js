'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = {
  guildId: null,
  channelId: null,
  mode: 'MIC',
  audio: {
    inputDevice: 'default', inputLabel: 'Default',
    auxDevice: null, auxLabel: null, useAux: false,
    volume: 100
  },
  tts: { language: 'fr', voice: '', speed: 160 },
  webhook: { enabled: false }
};

function configDir() {
  if (process.env.DVT_CONFIG_DIR) return process.env.DVT_CONFIG_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'discord-voice-terminal');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'discord-voice-terminal');
}

const DIR = configDir();
const CONFIG_FILE = path.join(DIR, 'config.json');
const SECRETS_FILE = path.join(DIR, 'secrets.json');
const LOG_FILE = path.join(DIR, 'dvt.log');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch (_) { /* sans effet sous Windows */ }
}

function merge(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    if (!(k in base)) continue;
    if (base[k] && typeof base[k] === 'object') out[k] = merge(base[k], extra[k]);
    else out[k] = extra[k];
  }
  return out;
}

function clamp(n, lo, hi, dflt) {
  n = Number(n);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

function loadConfig() {
  const cfg = merge(DEFAULTS, readJson(CONFIG_FILE, {}));
  cfg.mode = cfg.mode === 'TEXT' ? 'TEXT' : 'MIC';
  cfg.audio.volume = clamp(cfg.audio.volume, 0, 200, 100);
  cfg.tts.speed = clamp(cfg.tts.speed, 80, 300, 160);
  return cfg;
}

function saveConfig(cfg) { writeJson(CONFIG_FILE, cfg, 0o600); }

function loadSecrets() { return readJson(SECRETS_FILE, {}); }
function getSecret(name) { return loadSecrets()[name] || null; }
function setSecret(name, value) {
  const s = loadSecrets(); s[name] = value; writeJson(SECRETS_FILE, s, 0o600);
}
function deleteSecret(name) {
  const s = loadSecrets(); delete s[name]; writeJson(SECRETS_FILE, s, 0o600);
}

function getToken() {
  if (process.env.DISCORD_BOT_TOKEN) return { value: process.env.DISCORD_BOT_TOKEN.trim(), source: 'env' };
  const v = getSecret('token');
  return v ? { value: v, source: 'file' } : { value: null, source: null };
}

module.exports = {
  DIR, CONFIG_FILE, SECRETS_FILE, LOG_FILE,
  loadConfig, saveConfig, getSecret, setSecret, deleteSecret, getToken
};
