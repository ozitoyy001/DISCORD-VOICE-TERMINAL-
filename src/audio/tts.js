'use strict';
const { spawn } = require('child_process');

const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ESPEAK = () => process.env.ESPEAK_PATH || 'espeak-ng';

function probe(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
    p.on('error', () => resolve(false));
    p.on('close', (code) => resolve(code === 0));
  });
}

const available = () => probe(ESPEAK(), ['--version']);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function createSpeech(text, opts, onError) {
  const lang = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(opts.language || '') ? opts.language : 'en';
  const variant = /^[a-z0-9]{1,8}$/i.test(opts.voice || '') ? '+' + opts.voice : '';
  const speed = clamp(Math.round(Number(opts.speed) || 160), 80, 300);

  const esp = spawn(ESPEAK(), ['-v', lang + variant, '-s', String(speed), '--stdin', '--stdout'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const ff = spawn(FFMPEG(), ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-ac', '2', '-ar', '48000', '-f', 's16le', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  let ended = false;
  const kill = () => {
    ended = true;
    try { esp.kill(); } catch (_) {}
    try { ff.kill(); } catch (_) {}
  };
  const fail = (msg) => { if (!ended) { kill(); onError(msg); } };

  esp.on('error', () => fail('espeak-ng not found (install it or set ESPEAK_PATH)'));
  ff.on('error', () => fail('ffmpeg not found (install it or set FFMPEG_PATH)'));
  esp.on('close', (code) => { if (code) fail('espeak-ng failed (check language/voice)'); });
  esp.stdin.on('error', () => {});
  ff.stdin.on('error', () => {});
  esp.stderr.resume();
  ff.stderr.resume();

  esp.stdout.pipe(ff.stdin);
  esp.stdin.end(text, 'utf8');
  return { stdout: ff.stdout, kill };
}

module.exports = { available, createSpeech };
