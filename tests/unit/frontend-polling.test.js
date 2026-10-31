'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('stopping during an in-flight poll does not schedule another timer', async () => {
  const timers = new Map();
  let nextId = 0;
  const context = vm.createContext({
    window: {},
    document: { getElementById() { return {}; } },
    setTimeout(callback) { timers.set(++nextId, callback); return nextId; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/public/common.js'), 'utf8'), context);
  const polling = vm.runInContext('NTJ.polling', context);
  let finishRequest;
  let calls = 0;
  const poller = polling(() => {
    calls += 1;
    if (calls === 1) return Promise.resolve();
    return new Promise(resolve => { finishRequest = resolve; });
  }, 100);
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  const request = callback();
  poller.stop();
  finishRequest();
  await request;
  assert.equal(calls, 2);
  assert.equal(timers.size, 0);
});
