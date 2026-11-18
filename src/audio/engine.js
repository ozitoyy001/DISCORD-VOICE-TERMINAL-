'use strict';
const { spawn, execFile } = require('child_process');
const EventEmitter = require('events');
const {
  createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior, AudioPlayerStatus
} = require('@discordjs/voice');
const tts = require('./tts');

const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';

function run(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

async function listDevices() {
  const out = [{ id: 'default', name: 'Default' }];
  if (process.platform === 'win32') {
    const { stderr } = await run(FFMPEG(), ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
    for (const m of stderr.matchAll(/"([^"]+)"\s+\(audio\)/g)) out.push({ id: m[1], name: m[1] });
  } else if (process.platform === 'darwin') {
    const { stderr } = await run(FFMPEG(), ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
    let inAudio = false;
    for (const line of stderr.split('\n')) {
      if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
      if (/AVFoundation video devices/i.test(line)) { inAudio = false; continue; }
      const m = inAudio && line.match(/\[(\d+)\]\s+(.+)$/);
      if (m) out.push({ id: ':' + m[1], name: m[2].trim() });
    }
  } else {
    const { stdout } = await run('pactl', ['list', 'short', 'sources']);
    for (const line of stdout.split('\n')) {
      const c = line.split('\t');
      if (c[1] && !/\.monitor$/.test(c[1])) out.push({ id: c[1], name: c[1] });
    }
  }
  return out;
}

function inputArgs(id) {
  if (process.platform === 'win32') return ['-f', 'dshow', '-i', 'audio=' + id];
  if (process.platform === 'darwin') return ['-f', 'avfoundation', '-i', id === 'default' ? ':0' : id];
  return ['-f', 'pulse', '-i', id];
}

class AudioEngine extends EventEmitter {
  constructor(log, cfg) {
    super();
    this.log = log;
    this.cfg = cfg;
    this.muted = false;
    this.source = null;
    this.proc = null;
    this.resource = null;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    this.player.on('error', (e) => {
      this.log.error('player: ' + e.message);
      this.stop();
      this.emit('failure', 'AUDIO_PLAYER_FAILED', 'audio player error (see Logs)');
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (this.source) { this._cleanup(); this.emit('change'); }
    });
  }

  state() {
    if (!this.source) return 'IDLE';
    return this.muted ? 'MUTED' : 'STREAMING (' + this.source + ')';
  }

  _cleanup() {
    const p = this.proc;
    this.proc = null; this.source = null; this.resource = null;
    if (p) { try { p.kill(); } catch (_) {} }
  }

  _start(source, proc) {
    this._cleanup();
    const res = createAudioResource(proc.stdout, { inputType: StreamType.Raw, inlineVolume: true });
    this.proc = proc; this.source = source; this.resource = res;
    this._applyVolume();
    this.player.play(res);
    this.emit('change');
  }

  _applyVolume() {
    if (this.resource && this.resource.volume) {
      this.resource.volume.setVolume(this.muted ? 0 : this.cfg.audio.volume / 100);
    }
  }

  _failed(proc, msg) {
    if (this.proc === proc) this.stop();
    this.emit('failure', 'AUDIO_PROCESS_FAILED', msg);
  }

  async startMic(deviceId) {
    let dev = deviceId || 'default';
    if (process.platform === 'win32' && dev === 'default') {
      const list = await listDevices();
      if (list.length < 2) throw new Error('no input device found (is ffmpeg installed?)');
      dev = list[1].id;
    }
    const args = ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay',
      ...inputArgs(dev), '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'];
    const proc = spawn(FFMPEG(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let errTail = '';
    proc.stderr.on('data', (d) => { errTail = (errTail + d).slice(-300); });
    proc.on('error', () => this._failed(proc, 'ffmpeg not found (install it or set FFMPEG_PATH)'));
    proc.on('close', (code) => {
      if (this.proc === proc && code) {
        this._failed(proc, 'mic capture failed: ' + (errTail.trim().split('\n').pop() || 'unknown'));
      }
    });
    this._start('MIC', proc);
  }

  speak(text, opts) {
    const pipeline = tts.createSpeech(text, opts, (msg) => {
      this.stop();
      this.emit('failure', 'AUDIO_PROCESS_FAILED', msg);
    });
    this._start('TEXT', pipeline);
  }

  stop() {
    this._cleanup();
    this.player.stop(true);
    this.emit('change');
  }

  toggleMute() { this.muted = !this.muted; this._applyVolume(); this.emit('change'); }
  setVolume(n) { this.cfg.audio.volume = n; this._applyVolume(); this.emit('change'); }

  dispose() {
    this._cleanup();
    this.player.stop(true);
    this.player.removeAllListeners();
  }
}

module.exports = { AudioEngine, listDevices };
