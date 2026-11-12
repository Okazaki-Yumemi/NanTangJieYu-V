'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { gunzipSync } = require('node:zlib');
const { test } = require('node:test');
const { createApp, startServer } = require('../../server/index');

test('concurrent registration, idempotent trades, cache invalidation and HTTP compression', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-concurrency-'));
  const logger = { info() {}, warn() {}, error() {} };
  const config = { isProduction: false, host: '127.0.0.1', port: 0, dataDir,
    seedsDir: path.resolve(__dirname, '../../shared/seeds'), publicDir: path.resolve(__dirname, '../../web/public'),
    admin: { password: 'test-only', usingGeneratedPassword: false, entryPath: '/test-admin.html' }, cookieSecure: false };
  const app = createApp({ config, logger }); await app.store.initialize();
  const server = startServer(app, logger); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await app.store.flush(); await fs.rm(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function post(route, body, cookie = '') {
    const res = await fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] || '' };
  }
  // 密码在写事务外计算，但抢同一个码仍只能成功一次。
  const registrations = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/api/player/register', {
    code: '0001', display_name: `并发玩家${i}`, password: 'pass1234', team: 'reimu'
  })));
  assert.equal(registrations.filter(result => result.status === 200).length, 1);
  assert.ok(registrations.filter(result => result.status !== 200).every(result => result.data.error === 'CODE_ALREADY_USED'));
  const winner = registrations.find(result => result.status === 200);
  const user = Object.values(app.store.getLatest().users)[0];
  assert.equal((await post('/api/player/login', { display_name: user.display_name, password: 'wrong' })).data.error, 'INVALID_CREDENTIALS');
  assert.equal((await post('/api/player/login', { display_name: user.display_name, password: 'pass1234' })).status, 200);
  const joined = await post('/api/fx/join', { request_id: 'concurrency-join', expected_revision: 0 }, winner.cookie);
  assert.equal(joined.status, 200);
  const body = { request_id: 'concurrency-open', expected_revision: joined.data.account.revision, side: 'long', margin: 10000, leverage: 1, quote_seq: joined.data.market.seq };
  const trades = await Promise.all(Array.from({ length: 12 }, () => post('/api/fx/open', body, winner.cookie)));
  assert.ok(trades.every(result => result.status === 200));
  assert.equal(app.store.getLatest().fx.players[user.id].positions.length, 1);
  assert.equal(app.store.getLatest().fx.players[user.id].cash, 989995);
  const stateFile = JSON.parse(await fs.readFile(app.store.getPaths().stateFile));
  assert.equal(stateFile.fx.players[user.id].positions.length, 1);

  const first = await (await fetch(url + '/api/fx/state', { headers: { Cookie: winner.cookie } })).json();
  assert.equal(first.rows[0].display_name, user.display_name);
  await app.store.transact(state => { state.users[user.id].display_name = '改名后'; });
  const renamed = await (await fetch(url + '/api/fx/state')).json();
  assert.equal(renamed.rows[0].display_name, '改名后');
  await app.store.transact(state => { state.users[user.id].banned = true; });
  assert.equal((await (await fetch(url + '/api/fx/state')).json()).rows.length, 0);

  function raw(route, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request(url + route, { method, headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); req.end();
    });
  }
  const compressed = await raw('/api/public/state', { 'Accept-Encoding': 'gzip' });
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.equal(JSON.parse(gunzipSync(compressed.body)).activity.player_count, 1);
  const plain = await raw('/api/public/state', { 'Accept-Encoding': 'gzip;q=0, *;q=1' });
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(compressed.body.length < plain.body.length / 2);
  const staticFile = await raw('/fx.js');
  const cached = await raw('/fx.js', { 'If-None-Match': staticFile.headers.etag });
  assert.equal(cached.status, 304); assert.equal(cached.body.length, 0);
  const head = await raw('/fx.js', {}, 'HEAD');
  assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), staticFile.body.length);
});
