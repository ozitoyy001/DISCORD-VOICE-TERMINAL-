'use strict';
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('node:events');
const { installProcessHandlers } = require('../src/process-handlers');
const { describe } = require('../src/util/errors');

function setup() {
  const proc = new EventEmitter();
  const calls = { quit: [], soft: [], cleanup: 0, logs: [] };
  installProcessHandlers(proc, {
    log: { warn: (m) => calls.logs.push('W ' + m), error: (m) => calls.logs.push('E ' + m) },
    quit: (c) => calls.quit.push(c),
    soft: (m) => calls.soft.push(m),
    cleanup: () => { calls.cleanup += 1; }
  });
  return { proc, calls };
}

test('SIGTERM et SIGHUP => quit(0)', () => {
  const { proc, calls } = setup();
  proc.emit('SIGTERM'); proc.emit('SIGHUP');
  assert.deepEqual(calls.quit, [0, 0]);
});

test('uncaughtException => journal + quit(1)', () => {
  const { proc, calls } = setup();
  proc.emit('uncaughtException', new Error('boom'));
  assert.deepEqual(calls.quit, [1]);
  assert.match(calls.logs[0], /uncaught exception: .*boom/);
});

test('unhandledRejection => journal + ERROR affiche, pas de quit', () => {
  const { proc, calls } = setup();
  proc.emit('unhandledRejection', new Error('oops'));
  assert.deepEqual(calls.quit, []);
  assert.deepEqual(calls.soft, ['unexpected error (see Logs)']);
});

test('exit => cleanup des processus enfants', () => {
  const { proc, calls } = setup();
  proc.emit('exit');
  assert.equal(calls.cleanup, 1);
});

test('describe() renvoie une seule ligne et tronque', () => {
  const e = new Error('a\nb');
  assert.ok(!describe(e).includes('\n'));
  assert.ok(describe(new Error('x'.repeat(5000))).length <= 700);
  assert.equal(describe(null), 'unknown error');
});
