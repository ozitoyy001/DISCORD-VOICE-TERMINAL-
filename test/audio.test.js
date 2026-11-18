'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { AudioEngine } = require('../src/audio/engine');
const tts = require('../src/audio/tts');

const has = (bin, arg) => { const r = spawnSync(bin, [arg], { stdio: 'ignore' }); return !r.error && r.status === 0; };
const HAS_TTS = has('espeak-ng', '--version') && has('ffmpeg', '-version');
const log = { info() {}, warn() {}, error() {} };
const mkEngine = () => new AudioEngine(log, { audio: { volume: 100 } });
const withEnv = async (k, v, fn) => {
  const old = process.env[k]; process.env[k] = v;
  try { return await fn(); } finally { if (old === undefined) delete process.env[k]; else process.env[k] = old; }
};

test('TTS : binaire espeak-ng introuvable => onError explicite', async () => {
  await withEnv('ESPEAK_PATH', '/nonexistent/espeak', () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), 4000);
    const sp = tts.createSpeech('bonjour', { language: 'fr', speed: 160 }, (msg) => {
      clearTimeout(t); assert.match(msg, /espeak-ng not found/); resolve();
    });
    sp.stdout.on('error', () => {});
  }));
});

test('TTS reel : espeak-ng -> ffmpeg => PCM s16le 48 kHz stereo', { skip: !HAS_TTS && 'espeak-ng/ffmpeg absents' }, async () => {
  const chunks = [];
  const sp = tts.createSpeech('hello world', { language: 'en', voice: '', speed: 160 }, (m) => { throw new Error(m); });
  for await (const c of sp.stdout) chunks.push(c);
  const bytes = Buffer.concat(chunks).length;
  assert.ok(bytes > 48000 * 4 * 0.3, 'audio trop court : ' + bytes);   // > 0,3 s
  assert.equal(bytes % 4, 0, 'pas un multiple de 4 octets (s16le stereo)');
});

test('TTS : langue et voix invalides retombent sur des valeurs sures (aucune injection d\'option)', { skip: !HAS_TTS && 'espeak-ng/ffmpeg absents' }, async () => {
  const sp = tts.createSpeech('test', { language: '--stdout;rm', voice: '$(x)', speed: 99999 }, (m) => { throw new Error(m); });
  let n = 0; for await (const c of sp.stdout) n += c.length;
  assert.ok(n > 0);
});

test('Moteur reel : speak() => STREAMING (TEXT) puis retour a IDLE', { skip: !HAS_TTS && 'espeak-ng/ffmpeg absents' }, async () => {
  const e = mkEngine();
  const states = new Set();
  e.on('change', () => states.add(e.state()));
  e.on('failure', (c, m) => { throw new Error(c + ' ' + m); });
  e.speak('hello', { language: 'en', voice: '', speed: 160 });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('jamais revenu a IDLE : ' + [...states])), 15000);
    e.on('change', () => { if (e.state() === 'IDLE') { clearTimeout(t); resolve(); } });
  });
  assert.ok(states.has('STREAMING (TEXT)'), 'etats vus : ' + [...states]);
  e.dispose();
});

test('Moteur : ffmpeg introuvable => evenement failure explicite, sans plantage', async () => {
  await withEnv('FFMPEG_PATH', '/nonexistent/ffmpeg', async () => {
    const e = mkEngine();
    const failure = new Promise((resolve) => e.on('failure', (code, msg) => resolve({ code, msg })));
    await e.startMic('default').catch(() => {});
    const f = await Promise.race([failure, new Promise((_, rej) => setTimeout(() => rej(new Error('pas de failure')), 4000))]);
    assert.equal(f.code, 'AUDIO_PROCESS_FAILED'); assert.match(f.msg, /ffmpeg not found/);
    assert.equal(e.state(), 'IDLE');
    e.dispose();
  });
});

test('Volume et mute s\'appliquent a la ressource en cours', () => {
  const e = mkEngine();
  e._start('MIC', { stdout: Readable.from([Buffer.alloc(3840)]), kill() {} });
  assert.equal(e.resource.volume.volume, 1);
  e.setVolume(150); assert.equal(e.resource.volume.volume, 1.5);
  e.toggleMute();   assert.equal(e.resource.volume.volume, 0); assert.equal(e.state(), 'MUTED');
  e.toggleMute();   assert.equal(e.resource.volume.volume, 1.5);
  e.stop(); assert.equal(e.state(), 'IDLE');
  e.dispose();
});

test('stop() tue le processus et libere la source', () => {
  const e = mkEngine();
  let killed = 0;
  e._start('MIC', { stdout: Readable.from([Buffer.alloc(3840)]), kill() { killed++; } });
  e.stop();
  assert.equal(killed, 1); assert.equal(e.source, null);
  e.dispose();
});
