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

// Lit un JSON. Fichier absent => fallback. Fichier illisible/corrompu => il est mis de cote
// (<fichier>.corrupt-<date>) au lieu d'etre ecrase par la prochaine sauvegarde.
function readJson(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return fallback; }
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch (_) {
    try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch (__) { /* impossible : tant pis */ }
    return fallback;
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch (_) { /* sans effet sous Windows */ }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Fusion defensive : seules les cles connues de `base` sont lues (Object.hasOwn, donc ni
// __proto__ ni constructor), et une valeur n'est acceptee que si son type correspond.
function merge(base, extra) {
  const out = {};
  const src = isPlainObject(extra) ? extra : {};
  for (const k of Object.keys(base)) {
    const b = base[k];
    const has = Object.hasOwn(src, k);
    if (isPlainObject(b)) { out[k] = merge(b, has ? src[k] : {}); continue; }
    const v = has ? src[k] : undefined;
    if (v === undefined) { out[k] = b; continue; }
    if (b === null) out[k] = (v === null || typeof v === 'string') ? v : b;       // chaine ou null
    else out[k] = typeof v === typeof b ? v : b;                                   // meme type que le defaut
  }
  return out;
}

function clamp(n, lo, hi, dflt) {
  n = Number(n);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt;
}

const SNOWFLAKE = /^\d{15,25}$/;

function loadConfig() {
  const cfg = merge(DEFAULTS, readJson(CONFIG_FILE, {}));
  cfg.mode = cfg.mode === 'TEXT' ? 'TEXT' : 'MIC';
  cfg.guildId = SNOWFLAKE.test(String(cfg.guildId || '')) ? String(cfg.guildId) : null;
  cfg.channelId = SNOWFLAKE.test(String(cfg.channelId || '')) ? String(cfg.channelId) : null;
  if (!cfg.audio.inputDevice) { cfg.audio.inputDevice = 'default'; cfg.audio.inputLabel = 'Default'; }
  cfg.audio.volume = clamp(cfg.audio.volume, 0, 200, 100);
  cfg.tts.speed = clamp(cfg.tts.speed, 80, 300, 160);
  return cfg;
}

function saveConfig(cfg) { writeJson(CONFIG_FILE, cfg, 0o600); }

function loadSecrets() { return readJson(SECRETS_FILE, {}); }
function getSecret(name) {
  const s = loadSecrets();
  return Object.hasOwn(s, name) && typeof s[name] === 'string' && s[name] ? s[name] : null;
}
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
  DIR, CONFIG_FILE, SECRETS_FILE, LOG_FILE, DEFAULTS,
  loadConfig, saveConfig, getSecret, setSecret, deleteSecret, getToken, merge
};
