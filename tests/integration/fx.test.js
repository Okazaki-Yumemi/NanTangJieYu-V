'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { createApp, startServer } = require('../../server/index');
const { SESSION_COOKIE } = require('../../shared/constants');
const { createFixture } = require('../helpers/fixture');
const fx = require('../../server/domain/fx');

test('FX HTTP journey: auth, shared quotes, atomic duplicate orders, private accounts, restart persistence and no client scores', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-fx-'));
  const config = { isProduction: false, host: '127.0.0.1', port: 0, dataDir,
    seedsDir: path.resolve(__dirname, '../../shared/seeds'), publicDir: path.resolve(__dirname, '../../web/public'),
    admin: { password: 'test-password', usingGeneratedPassword: false, entryPath: '/admin-test.html' }, cookieSecure: false };
  const logger = { info() {}, warn() {}, error() {} };
  const app = createApp({ config, logger }); await app.store.initialize();
  const fixture = createFixture({ userCount: 2, now: Math.floor(Date.now() / 1000) });
  // 此旅程验证交易接口；灾难行情的强平另有确定性测试，避免随机强平影响普通平仓。
  fx.advanceMarket(fixture.state);
  fixture.state.fx.market.event_cooldown = 10;
  for (const [index, user] of fixture.registered.entries()) fixture.state.sessions[`fx-session-${index}`] = { user_id: user.id, created_at: Math.floor(Date.now() / 1000), last_seen_at: Math.floor(Date.now() / 1000) };
  await app.store.replaceState(fixture.state);
  const server = startServer(app, logger); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  async function request(route, body, user = 0) {
    const response = await fetch(`${url}${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(user === null ? {} : { Cookie: `${SESSION_COOKIE}=fx-session-${user}` }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const body = { request_id: 'join_player_one', expected_revision: 0 };
  assert.equal((await request('/api/fx/join', body, null)).status, 401);
  assert.equal((await request('/api/fx/open', null)).status, 400);
  const joined = await request('/api/fx/join', body);
  assert.equal(joined.status, 200); assert.equal(joined.data.account.cash, 1000000);
  const guest = await request('/api/fx/state', undefined, null);
  assert.equal(guest.data.account, null); assert.equal(guest.headers.get('cache-control'), 'no-store');
  assert.equal(guest.data.market.seq, joined.data.market.seq);
  assert.equal((await request('/api/fx/state', undefined, 1)).data.account, null);
  const order = { request_id: 'open_player_one', expected_revision: 1, quote_seq: guest.data.market.seq, margin: 100000, leverage: 10, side: 'long', cash: 1e15, entry_price: 1 };
  const results = await Promise.all([request('/api/fx/open', order), request('/api/fx/open', order)]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.data.repeated).length, 1);
  const current = (await request('/api/fx/state')).data;
  assert.equal(current.account.positions.length, 1); assert.equal(current.account.cash, 899500);
  assert.equal(current.rows[0].equity, current.account.equity);
  assert.equal((await request('/api/arcade/score', { game: 'fx', mode: 'default', score: 999999 })).status, 400);
  const otherJoin = await request('/api/fx/join', { ...body, request_id: 'join_player_two' }, 1);
  assert.equal(otherJoin.data.account.cash, 1000000);
  assert.equal((await request('/api/fx/close', { request_id: 'steal_position_test', expected_revision: 1, position_id: current.account.positions[0].id }, 1)).status, 409);
  // 重新打开同一状态目录，模拟进程重启；行情和持仓不能丢失。
  const reopened = createApp({ config, logger }); await reopened.store.initialize();
  assert.deepEqual(reopened.store.getLatest().fx, app.store.getLatest().fx);
  const beforeTick = app.store.getLatest().fx.market.seq;
  await new Promise(resolve => setTimeout(resolve, fx.RULES.tick_ms + 500));
  assert.ok(app.store.getLatest().fx.market.seq > beforeTick, 'timer advances with no polling');
  const close = { request_id: 'close_player_one', expected_revision: current.account.revision, position_id: current.account.positions[0].id };
  const closed = await request('/api/fx/close', close);
  assert.equal(closed.status, 200); assert.equal(closed.data.account.positions.length, 0);
  assert.equal((await request('/api/fx/close', close)).data.repeated, true);
  const playerId = fixture.registered[0].id;
  await app.store.transact(state => { state.fx.players[playerId].cash = 0; });
  const workBody = { request_id: 'work_player_one', expected_revision: closed.data.account.revision, ready_at: 0 };
  const work = await request('/api/fx/work', workBody);
  assert.equal(work.status, 200);
  assert.equal(work.data.account.job.ready_at - work.data.account.job.started_at, 900000);
  assert.equal((await request('/api/fx/work', workBody)).data.repeated, true);
  assert.equal((await request('/api/fx/claim-work', { request_id: 'early_claim_test', expected_revision: work.data.account.revision })).status, 400);
  const loanBody = { request_id: 'borrow_player_one', expected_revision: work.data.account.revision };
  const loan = await request('/api/fx/borrow', loanBody);
  assert.equal(loan.data.account.cash, 300000); assert.equal(loan.data.account.debt, 300000);
  assert.equal(loan.data.account.equity, 0);
  assert.equal((await request('/api/fx/borrow', loanBody)).data.repeated, true);
  const repaid = await request('/api/fx/repay', { request_id: 'repay_player_one', expected_revision: loan.data.account.revision });
  assert.equal(repaid.data.account.cash, 0); assert.equal(repaid.data.account.debt, 0);
  const jobReopen = createApp({ config, logger }); await jobReopen.store.initialize();
  assert.deepEqual(jobReopen.store.getLatest().fx.players[playerId].job, work.data.account.job);
  await app.store.transact(state => { state.fx.players[playerId].job.ready_at = Date.now() - 1; });
  const payBody = { request_id: 'salary_player_one', expected_revision: repaid.data.account.revision };
  const paid = await request('/api/fx/claim-work', payBody);
  assert.equal(paid.status, 200); assert.equal(paid.data.account.cash, 150000); assert.equal(paid.data.account.job, null);
  assert.equal((await request('/api/fx/claim-work', payBody)).data.account.cash, 150000);
  assert.equal((await request('/api/fx/restart', { request_id: 'no_free_restart', expected_revision: paid.data.account.revision })).status, 404);
  await app.store.transact(state => { state.users[fixture.registered[0].id].banned = true; });
  assert.equal((await request('/api/fx/join', body)).status, 403);
  const board = (await request('/api/fx/state', undefined, null)).data.rows;
  assert.equal(board.length, 1); assert.equal(board[0].display_name, fixture.registered[1].display_name); assert.equal(board[0].rank, 1);
  const arcade = await (await fetch(`${url}/arcade.html`)).text();
  assert.match(arcade, /FX战士天弓千亦/); assert.match(arcade, /href="\/fx.html"/); assert.doesNotMatch(arcade, /后户鼓乐/);
  const legacy = await (await fetch(`${url}/rhythm.html`)).text(); assert.match(legacy, /url=\/fx.html/);
});
