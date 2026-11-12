'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { createApp, startServer } = require('../../server/index');
const { loadSeeds, validateSeeds } = require('../../server/seed-loader');
const { buildInitialState } = require('../../server/domain/state');
const codes = require('../../server/domain/codes');

const seedsDir = path.resolve(__dirname, '../../shared/seeds');
const logger = { info() {}, warn() {}, error() {} };

test('fresh state contains exactly 50 usable public test codes with leading zeroes', () => {
  const seeds = loadSeeds(seedsDir);
  const expected = Array.from({ length: 50 }, (_, index) => String(index + 1).padStart(4, '0'));
  assert.deepEqual(seeds.publicTestCodes, expected);
  const state = buildInitialState(seeds);
  assert.deepEqual(Object.keys(state.codes).sort(), expected);
  assert.ok(Object.values(state.codes).every(entry => codes.isUsable(entry) && entry.type === 'ordinary'));
  for (const invalid of [[1], ['001'], ['0001', '0001']]) {
    assert.ok(validateSeeds({ ...seeds, publicTestCodes: invalid }).some(problem => problem.includes('public-test-codes.json')));
  }
});

test('existing data imports public codes once; registration, disabled codes and bindings survive restart', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-public-test-'));
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const config = {
    isProduction: false, host: '127.0.0.1', port: 0, dataDir, seedsDir,
    publicDir: path.resolve(__dirname, '../../web/public'), cookieSecure: false,
    admin: { password: 'test-admin-password', usingGeneratedPassword: false, entryPath: '/test-admin.html' }
  };
  // 模拟升级前已有的数据目录与管理员生成的码。
  const oldApp = createApp({ config, logger, transformSeeds(seeds) { seeds.publicTestCodes = []; } });
  await oldApp.store.initialize();
  const legacy = await oldApp.store.transact(state => codes.generateCodes(state, { count: 1 }, 1700000000));
  const legacyCode = legacy.created[0];

  let app = createApp({ config, logger });
  await app.store.initialize();
  assert.equal(Object.keys(app.store.getLatest().codes).length, 51);
  assert.deepEqual(app.store.getLatest().codes[legacyCode.code], legacyCode);
  await app.store.transact(state => codes.setCodeDisabled(state, '0002', true));

  async function start() {
    server = startServer(app, logger);
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  let url = await start();
  async function register(code, displayName, team = 'reimu') {
    const response = await fetch(`${url}/api/player/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, display_name: displayName, password: 'pass1234', team })
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await register('0001', '公测甲')).status, 200);
  assert.equal((await register('0050', '公测乙', 'marisa')).status, 200);
  assert.equal((await register('0002', '禁用码')).body.error, 'CODE_DISABLED');
  for (const code of ['0000', '0051', '1']) {
    assert.equal((await register(code, '无效码')).body.error, 'INVALID_CODE');
  }
  const boundCode = structuredClone(app.store.getLatest().codes['0001']);
  await new Promise(resolve => server.close(resolve));

  app = createApp({ config, logger });
  await app.store.initialize();
  url = await start();
  assert.equal(Object.keys(app.store.getLatest().codes).length, 51);
  assert.deepEqual(app.store.getLatest().codes['0001'], boundCode);
  assert.equal(Object.keys(app.store.getLatest().users).length, 2);
  assert.equal((await register('0001', '再次使用')).body.error, 'CODE_ALREADY_USED');
  assert.equal((await register('0002', '仍已禁用')).body.error, 'CODE_DISABLED');
  assert.equal((await register('0003', '公测丙')).status, 200);
});
