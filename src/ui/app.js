'use strict';
const readline = require('readline');
const { Writable } = require('stream');
const config = require('../config');
const tts = require('../audio/tts');
const { listDevices } = require('../audio/engine');
const { isValidUrl } = require('../notify/webhook');
const { frame } = require('./render');
const { AppError, describe } = require('../util/errors');

const PAGE = 8;
const CLEAR = '\x1b[2J\x1b[3J\x1b[H';

class App {
  constructor({ cfg, discord, audio, notifier, log }) {
    Object.assign(this, { cfg, discord, audio, notifier, log });
    this.screen = 'main';
    this.level = 'READY';
    this.status = 'Ready';
    this.voiceView = 'servers';
    this.page = 0;
    this.devices = [];
    this.pending = null;
    this.muted = false;
    this.closing = false;
    this.busy = new Set();
    this.ttsOk = null;
    this.promptText = 'Command > ';
    this.handlers = {
      main: (l) => this.onMain(l), conn: (l) => this.onConn(l), voice: (l) => this.onVoice(l),
      audio: (l) => this.onAudio(l), tts: (l) => this.onTts(l), webhook: (l) => this.onWebhook(l),
      logs: (l) => this.onLogs(l)
    };

    discord.on('change', () => this.draw());
    discord.on('state', (next, prev) => {
      if (next === 'CONNECTED') this.notifier.notify('CONNECTED');
      else if (next === 'DISCONNECTED' && prev === 'CONNECTED' && !this.closing) this.notifier.notify('DISCONNECTED');
    });
    discord.on('joined', () => this.notifier.notify('VOICE_JOINED'));
    discord.on('left', () => {
      this.audio.stop();
      if (!this.closing) this.notifier.notify('VOICE_LEFT'); // a la fermeture, quit() l'envoie lui-meme
      this.draw();
    });
    audio.on('change', () => this.draw());
    audio.on('failure', (code, msg) => {
      this.log.error(code + ': ' + msg);
      this.err(msg);
      this.notifier.notify('ERROR', code);
      this.draw();
    });
  }

  start() {
    this.out = new Writable({
      write: (chunk, enc, cb) => { if (!this.muted) process.stdout.write(chunk, enc); cb(); }
    });
    Object.defineProperty(this.out, 'columns', { get: () => process.stdout.columns });
    Object.defineProperty(this.out, 'isTTY', { value: true });
    this.rl = readline.createInterface({
      input: process.stdin, output: this.out, terminal: true, historySize: 0, prompt: this.promptText
    });
    this.rl.on('line', (l) => this.onLine(l));
    this.rl.on('SIGINT', () => this.quit());
    this.rl.on('close', () => this.quit());
    tts.available().then((ok) => {
      this.ttsOk = ok;
      if (!ok) this.log.warn('espeak-ng not found: TEXT mode unavailable');
    });
    this.drawNow();
  }

  async quit(code = 0) {
    if (this.closing) return;
    this.closing = true;
    const guard = setTimeout(() => process.exit(1), 6000);
    try {
      this.audio.stop();
      const wasConnected = this.discord.state === 'CONNECTED';
      const hadVoice = !!this.discord.connection;
      this.discord.leave();
      const alerts = [];
      if (hadVoice) alerts.push(this.notifier.notifyNow('VOICE_LEFT'));
      if (wasConnected) alerts.push(this.notifier.notifyNow('DISCONNECTED'));
      await Promise.all(alerts);
      await this.discord.disconnect();
      this.audio.dispose();
    } catch (e) {
      this.log.error('shutdown: ' + e.message);
    }
    clearTimeout(guard);
    this.rl.close();
    process.stdout.write('\n');
    process.exit(code);
  }

  draw() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._draw(), 50);
  }

  drawNow() { clearTimeout(this.timer); this._draw(); }

  _draw() {
    if (this.closing || this.muted) return;
    process.stdout.write(CLEAR + frame({
      header: this.header(), body: this.body(), level: this.level, status: this.status
    }) + '\n');
    this.rl.setPrompt(this.promptText);
    this.rl.prompt(true);
  }

  ok(msg) { this.level = 'READY'; this.status = msg; }
  err(msg) { this.level = 'ERROR'; this.status = msg; }
  working(msg) { this.level = 'WORKING'; this.status = msg; this.drawNow(); }

  header() {
    const d = this.discord, c = this.cfg, a = c.audio;
    const inp = a.useAux ? 'AUX ' + (a.auxLabel || '-') : (a.inputLabel || 'Default');
    return [
      'Bot    : ' + d.state + (d.user ? ' (' + d.user + ')' : ''),
      'Server : ' + (d.guildName(c.guildId) || '-'),
      'Voice  : ' + (d.channelName(c.guildId, c.channelId) || '-') + (d.connection ? ' [JOINED]' : ' [NOT JOINED]'),
      'Mode   : ' + c.mode,
      'Input  : ' + inp,
      'Audio  : ' + this.audio.state() + '   Volume : ' + a.volume
    ];
  }

  body() {
    switch (this.screen) {
      case 'conn': return this.bodyConn();
      case 'voice': return this.bodyVoice();
      case 'audio': return this.bodyAudio();
      case 'tts': return this.bodyTts();
      case 'webhook': return this.bodyWebhook();
      case 'logs': return this.bodyLogs();
      default: return [
        '[1] Connection       [2] Voice channel',
        '[3] Audio settings   [4] Text to speech',
        '[5] Webhook          [6] Logs',
        '[Q] Quit',
        '',
        'Global: start | stop | mute | vol <0-200> | help'
      ];
    }
  }

  bodyConn() {
    const t = config.getToken();
    return [
      'CONNECTION',
      'Token : ' + (t.value ? 'SET (' + t.source + ') ********' : 'NOT SET'),
      '',
      '[1] Set or replace token    [2] Delete token',
      '[3] Verify token            [4] Connect bot',
      '[5] Disconnect bot          [B] Back'
    ];
  }

  voiceItems() {
    return this.voiceView === 'servers' ? this.discord.guilds() : this.discord.voiceChannels(this.cfg.guildId);
  }

  bodyVoice() {
    const items = this.voiceItems();
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    const sel = this.voiceView === 'servers' ? this.cfg.guildId : this.cfg.channelId;
    const lines = ['VOICE CHANNEL - ' + (this.voiceView === 'servers' ? 'select server' : 'select channel')];
    if (this.discord.state !== 'CONNECTED') lines.push('Bot not connected. Use screen [1] first.');
    else if (!items.length) lines.push('(none)');
    items.slice(this.page * PAGE, this.page * PAGE + PAGE).forEach((it, i) => {
      const n = this.page * PAGE + i + 1;
      lines.push((it.id === sel ? '> ' : '  ') + '[' + n + '] ' + it.name + (it.canJoin === false ? ' (no permission)' : ''));
    });
    lines.push('Page ' + (this.page + 1) + '/' + pages + '   [N] next  [P] prev');
    lines.push('[number] select  [S] servers  [J] join  [L] leave  [B] back');
    return lines;
  }

  bodyAudio() {
    const a = this.cfg.audio;
    const lines = [
      'AUDIO SETTINGS',
      'Mode   : ' + this.cfg.mode + '     [1] toggle MIC/TEXT',
      'Source : ' + (a.useAux ? 'AUX' : 'INPUT') + '     [3] toggle INPUT/AUX',
      'Input  : ' + (a.inputLabel || 'Default') + '     i <n> select',
      'Aux    : ' + (a.auxLabel || '-') + '     x <n> select, x 0 = none',
      'Volume : ' + a.volume + '     vol <0-200>',
      'Commands: start | stop | mute      [2] list devices   [B] back'
    ];
    this.devices.slice(0, 8).forEach((d, i) => lines.push('  [' + (i + 1) + '] ' + d.name));
    return lines;
  }

  bodyTts() {
    const t = this.cfg.tts;
    return [
      'TEXT TO SPEECH',
      'Engine : espeak-ng (' + (this.ttsOk === null ? 'checking' : this.ttsOk ? 'found' : 'NOT FOUND') + ')',
      'Lang : ' + t.language + '   Voice : ' + (t.voice || '-') + '   Speed : ' + t.speed,
      'Type text + Enter to speak it (interrupts current audio).',
      'Commands: /lang xx  /voice name  /speed N  /stop  /mute',
      '          /vol N  /b (back)  /q (quit)'
    ];
  }

  bodyWebhook() {
    const url = config.getSecret('webhookUrl');
    return [
      'WEBHOOK ALERTS',
      'Alerts : ' + (this.cfg.webhook.enabled ? 'ON' : 'OFF'),
      'URL    : ' + (url ? 'SET ********' : 'NOT SET'),
      'Sent   : connect, disconnect, voice join/leave, error codes.',
      'Never  : token, microphone, typed text, names.',
      '[1] Set URL  [2] Remove URL  [3] Toggle ON/OFF  [4] Test  [B] Back'
    ];
  }

  bodyLogs() {
    const last = this.log.entries.slice(-14);
    return ['LOGS (last 14, secrets redacted)', ...(last.length ? last : ['(empty)']), '[B] Back'];
  }

  askSecret(label) {
    return new Promise((resolve) => {
      this.pending = { resolve };
      this.level = 'READY';
      this.status = label + ' (hidden input, empty = cancel)';
      this.promptText = 'Secret > ';
      this.drawNow();
      this.muted = true;
    });
  }

  onLine(raw) {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.muted = false;
      this.promptText = 'Command > ';
      p.resolve(raw.trim());
      return;
    }
    this.handle(raw.trim());
  }

  async handle(line) {
    if (!line) { this.draw(); return; }
    try {
      let done = await this.handlers[this.screen](line);
      if (!done) done = await this.global(line);
      if (!done) this.err('unknown command (type help)');
    } catch (e) {
      this.report(e);
    }
    this.draw();
  }

  report(e, code) {
    const known = e instanceof AppError;
    // Erreur connue : message seul. Erreur inattendue : message + debut de stack (aide au debogage).
    this.log.error((code || 'ERROR') + ': ' + (known ? e.message : describe(e)));
    this.err(known ? e.message : 'unexpected error (see Logs)');
    if (code && (!known || e.alert)) this.notifier.notify('ERROR', code);
  }

  async guard(code, fn) { try { await fn(); } catch (e) { this.report(e, code); } }

  async exclusive(key, fn) {
    if (this.busy.has(key)) throw new AppError('operation already in progress');
    this.busy.add(key);
    try { return await fn(); } finally { this.busy.delete(key); }
  }

  save() {
    try { config.saveConfig(this.cfg); } catch (e) { this.log.error('config save: ' + e.message); }
  }

  go(screen) {
    this.screen = screen;
    this.page = 0;
    if (screen === 'voice') {
      this.voiceView = this.discord.guildName(this.cfg.guildId) ? 'channels' : 'servers';
    }
  }

  async global(line) {
    const [cmd, arg] = line.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'q': case 'quit': await this.quit(); return true;
      case 'help': this.ok('Menu: number + Enter. Global: start stop mute vol N q'); return true;
      case 'mute': this.audio.toggleMute(); this.ok(this.audio.muted ? 'MUTED' : 'Unmuted'); return true;
      case 'stop': this.audio.stop(); this.ok('Stopped'); return true;
      case 'vol': this.setVolume(arg); return true;
      case 'start': await this.guard('AUDIO_START_FAILED', () => this.startMic()); return true;
      default: return false;
    }
  }

  setVolume(arg) {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 0 || n > 200) throw new AppError('volume must be an integer 0-200');
    this.audio.setVolume(n);
    this.save();
    this.ok('Volume ' + n);
  }

  async startMic() {
    if (!this.discord.connection) throw new AppError('join a voice channel first');
    const a = this.cfg.audio;
    if (a.useAux && !a.auxDevice) throw new AppError('no auxiliary input selected');
    this.cfg.mode = 'MIC';
    this.save();
    await this.audio.startMic(a.useAux ? a.auxDevice : a.inputDevice);
    this.ok('MIC streaming');
  }

  async say(text) {
    if (!this.discord.connection) throw new AppError('join a voice channel first');
    if (this.ttsOk === false) throw new AppError('espeak-ng not found (install it or set ESPEAK_PATH)');
    if (text.length > 500) throw new AppError('text too long (max 500 characters)');
    this.cfg.mode = 'TEXT';
    this.save();
    this.audio.speak(text, this.cfg.tts);
    this.ok('Speaking (TEXT)');
  }

  async onMain(l) {
    const map = { 1: 'conn', 2: 'voice', 3: 'audio', 4: 'tts', 5: 'webhook', 6: 'logs' };
    if (map[l]) { this.go(map[l]); this.ok('Ready'); return true; }
    return false;
  }

  async onConn(l) {
    switch (l.toLowerCase()) {
      case '1': await this.setToken(); return true;
      case '2': await this.deleteToken(); return true;
      case '3': await this.guard('TOKEN_CHECK_FAILED', () => this.verifyToken()); return true;
      case '4': await this.guard('LOGIN_FAILED', () => this.connectBot()); return true;
      case '5': await this.exclusive('connect', () => this.discord.disconnect()); this.ok('Bot DISCONNECTED'); return true;
      case 'b': this.go('main'); return true;
      default: return false;
    }
  }

  async setToken() {
    if (process.env.DISCORD_BOT_TOKEN) throw new AppError('token comes from DISCORD_BOT_TOKEN: unset it first');
    const v = await this.askSecret('Paste bot token');
    if (!v) { this.ok('Cancelled'); return; }
    if (/\s/.test(v) || v.length < 30) throw new AppError('token format rejected (no spaces, 30+ chars)');
    config.setSecret('token', v);
    this.log.registerSecret(v);
    await this.guard('TOKEN_CHECK_FAILED', () => this.verifyToken());
  }

  async deleteToken() {
    if (process.env.DISCORD_BOT_TOKEN) throw new AppError('token comes from DISCORD_BOT_TOKEN: unset it');
    await this.exclusive('connect', () => this.discord.disconnect());
    config.deleteSecret('token');
    this.ok('Token deleted, bot DISCONNECTED');
  }

  async verifyToken() {
    const t = config.getToken();
    if (!t.value) throw new AppError('no token configured');
    this.log.registerSecret(t.value);
    this.working('Verifying token...');
    const u = await this.discord.validateToken(t.value);
    this.ok('Token valid (bot: ' + u.name + ')');
  }

  async connectBot() {
    await this.exclusive('connect', async () => {
      const t = config.getToken();
      if (!t.value) throw new AppError('no token configured');
      this.log.registerSecret(t.value);
      this.working('Connecting...');
      await this.discord.connect(t.value);
      this.ok('Bot CONNECTED');
    });
  }

  async onVoice(l) {
    const k = l.toLowerCase();
    if (k === 'b') { this.go('main'); return true; }
    if (k === 's') { this.voiceView = 'servers'; this.page = 0; return true; }
    if (k === 'n') { this.page += 1; return true; }
    if (k === 'p') { this.page = Math.max(0, this.page - 1); return true; }
    if (k === 'l') {
      this.ok(this.discord.leave() ? 'Left voice channel' : 'Not in a voice channel');
      return true;
    }
    if (k === 'j') { await this.guard('VOICE_JOIN_FAILED', () => this.joinVoice()); return true; }
    if (/^\d+$/.test(k)) {
      const it = this.voiceItems()[Number(k) - 1];
      if (!it) throw new AppError('no such item');
      if (this.voiceView === 'servers') {
        this.cfg.guildId = it.id; this.cfg.channelId = null; this.voiceView = 'channels'; this.page = 0;
        this.ok('Server selected: pick a voice channel');
      } else {
        this.cfg.channelId = it.id;
        this.ok('Channel selected: [J] to join');
      }
      this.save();
      return true;
    }
    return false;
  }

  async joinVoice() {
    await this.exclusive('join', async () => {
      if (!this.cfg.guildId || !this.cfg.channelId) throw new AppError('select a server and a voice channel first');
      this.working('Joining voice channel...');
      await this.discord.join(this.cfg.guildId, this.cfg.channelId);
      this.ok('Joined voice channel');
    });
  }

  async onAudio(l) {
    const [cmd, arg] = l.split(/\s+/);
    const a = this.cfg.audio;
    switch (cmd.toLowerCase()) {
      case '1':
        this.cfg.mode = this.cfg.mode === 'MIC' ? 'TEXT' : 'MIC';
        this.audio.stop(); this.save(); this.ok('Mode ' + this.cfg.mode); return true;
      case '2':
        this.working('Listing devices...');
        this.devices = await listDevices();
        this.ok(this.devices.length + ' device(s) listed: i <n> or x <n>'); return true;
      case '3':
        a.useAux = !a.useAux; this.save(); this.ok('Source ' + (a.useAux ? 'AUX' : 'INPUT')); return true;
      case 'b': this.go('main'); return true;
      default:
        if (/^i\s+\d+$/.test(cmd + ' ' + (arg || ''))) {
          const d = this.devices[Number(arg) - 1];
          if (!d) throw new AppError('no such input device (use [2] to list)');
          a.inputDevice = d.id; a.inputLabel = d.name; this.save();
          this.ok('Input: ' + d.name); return true;
        }
        if (/^x\s+\d+$/.test(cmd + ' ' + (arg || ''))) {
          const n = Number(arg);
          if (n === 0) { a.auxDevice = null; a.auxLabel = null; this.save(); this.ok('Aux cleared'); return true; }
          const d = this.devices[n - 1];
          if (!d) throw new AppError('no such aux device (use [2] to list)');
          a.auxDevice = d.id; a.auxLabel = d.name; this.save();
          this.ok('Aux: ' + d.name); return true;
        }
        return false;
    }
  }

  async onTts(l) {
    if (l === '/b') { this.go('main'); return true; }
    if (l === '/q') { await this.quit(); return true; }
    if (l === '/stop') { this.audio.stop(); this.ok('Stopped'); return true; }
    if (l === '/mute') { this.audio.toggleMute(); this.ok(this.audio.muted ? 'MUTED' : 'Unmuted'); return true; }
    if (l.startsWith('/lang ')) {
      const v = l.slice(6).trim();
      if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(v)) throw new AppError('invalid language code');
      this.cfg.tts.language = v; this.save(); this.ok('Language ' + v); return true;
    }
    if (l.startsWith('/voice ')) {
      const v = l.slice(7).trim();
      if (v && !/^[a-z0-9]{1,8}$/i.test(v)) throw new AppError('invalid voice name');
      this.cfg.tts.voice = v; this.save(); this.ok('Voice ' + (v || 'default')); return true;
    }
    if (l.startsWith('/speed ')) {
      const n = Number(l.slice(7).trim());
      if (!Number.isInteger(n) || n < 80 || n > 300) throw new AppError('speed must be 80-300');
      this.cfg.tts.speed = n; this.save(); this.ok('Speed ' + n); return true;
    }
    if (l.startsWith('/vol ')) { this.setVolume(l.slice(5).trim()); return true; }
    await this.say(l);
    return true;
  }

  async onWebhook(l) {
    switch (l.toLowerCase()) {
      case '1': {
        const v = await this.askSecret('Paste webhook URL');
        if (!v) { this.ok('Cancelled'); return true; }
        if (!isValidUrl(v)) throw new AppError('invalid Discord webhook URL');
        config.setSecret('webhookUrl', v);
        this.log.registerSecret(v);
        this.ok('Webhook URL saved'); return true;
      }
      case '2':
        config.deleteSecret('webhookUrl');
        this.ok('Webhook URL removed'); return true;
      case '3':
        this.cfg.webhook.enabled = !this.cfg.webhook.enabled;
        this.save();
        this.ok('Alerts ' + (this.cfg.webhook.enabled ? 'ON' : 'OFF')); return true;
      case '4':
        await this.guard('WEBHOOK_TEST_FAILED', async () => {
          const url = config.getSecret('webhookUrl');
          if (!url || !isValidUrl(url)) throw new AppError('no valid webhook URL configured');
          this.working('Testing webhook...');
          const n = new (require('../notify/webhook').Notifier)(this.log, () => url, () => true);
          await n.test();
          this.ok('Webhook test sent');
        });
        return true;
      case 'b': this.go('main'); return true;
      default: return false;
    }
  }

  onLogs(l) {
    if (l.toLowerCase() === 'b') { this.go('main'); return true; }
    return false;
  }
}

module.exports = { App };
