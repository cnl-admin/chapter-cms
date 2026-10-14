'use strict';
// Shared test setup: the demo data loaded into the in-memory store (the same code the demo runs), a clock, and the
// editor API.
const fs = require('fs'), path = require('path');
const { MemoryStore } = require('../lib/memstore');
const { createCms } = require('../lib/cms');
const { createApi, errorResponse } = require('../lib/api');

const DATA = path.join(__dirname, '..', 'data');
// Every JSON file under data/<chapter> as store keys ("item/events/x.json" -> "item/events/x").
function load(dir, pre = '', out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) load(path.join(dir, e.name), pre + e.name + '/', out);
    else if (e.name.endsWith('.json')) out[pre + e.name.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8'));
  }
  return out;
}
const seed = () => ({ demo: load(path.join(DATA, 'demo')), national: load(path.join(DATA, 'national')) });
function setup({ at = '2030-01-01T12:00:00Z', data = seed() } = {}) {
  let t = Date.parse(at);
  const clock = { tick: (ms) => { t += ms; } };
  const store = new MemoryStore(data);
  const cms = createCms({ store, now: () => new Date(t) });
  const api = createApi({ cms, now: () => t });
  const call = (method, p, body, user = 'Sam') => api.handle({ method, path: p, body, user }).catch(errorResponse);
  return { cms, call, clock, store };
}
module.exports = { load, seed, setup, DATA };
