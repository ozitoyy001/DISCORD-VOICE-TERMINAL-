'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ascii, pad } = require('../src/util/ascii');
const { AppError } = require('../src/util/errors');
const { isValidUrl } = require('../src/notify/webhook');

test('ascii strips non printable characters', () => {
  assert.equal(ascii('caf\u00e9'), 'cafe');
  assert.equal(ascii('a\u2713b'), 'a?b');
});

test('pad truncates and fills', () => {
  assert.equal(pad('abcdef', 4), 'a...');   // la limite inclut les points de suspension
  assert.equal(pad('ab', 4), 'ab  ');
});

test('AppError carries alert flag', () => {
  const e = new AppError('boom', true);
  assert.equal(e.message, 'boom');
  assert.equal(e.alert, true);
});

test('webhook URL validation', () => {
  assert.equal(isValidUrl('https://discord.com/api/webhooks/123/abc'), true);
  assert.equal(isValidUrl('http://discord.com/api/webhooks/123/abc'), false);
  assert.equal(isValidUrl('https://example.com'), false);
});
