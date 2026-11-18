'use strict';
const { pad } = require('../util/ascii');

const W = 60;
const row = (t) => '| ' + pad(t, W - 4) + ' |';
const rule = (c) => '+' + c.repeat(W - 2) + '+';

function frame(v) {
  const out = [rule('-'), row('DISCORD VOICE TERMINAL'), rule('=')];
  v.header.forEach((s) => out.push(row(s)));
  out.push(rule('-'));
  v.body.forEach((s) => out.push(row(s)));
  out.push(rule('-'));
  out.push(row('Status : ' + v.level + ' | ' + v.status));
  out.push(rule('-'));
  return out.join('\n');
}

module.exports = { frame };
