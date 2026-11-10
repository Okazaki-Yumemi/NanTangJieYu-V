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

function arcadeBoards(now) {
  const boards = [];
  for (const mode of ['spring', 'summer', 'autumn', 'winter', 'boundary', 'frost', 'storehouse', 'crossroads']) {
    boards.push({ game: 'puzzle', mode });
  }
  for (const mode of ['normal', 'expert']) {
    boards.push({ game: 'danmaku', mode });
  }
  for (const song of ['four-seasons', 'hidden-star']) {
    for (const difficulty of ['normal', 'hard', 'expert', 'master', 'lunatic']) {
      for (const source of ['original', 'original-3m', 'practice']) {
        boards.push({ game: 'rhythm', mode: `${song}-${difficulty}-${source}` });
      }
    }
  }
  boards.push({ game: 'dye', mode: new Date(now + 8 * 3600000).toISOString().slice(0, 10) });
  return boards;
}

test('bans remove players from every fishing and arcade board and refill continuous ranks', async (t) => {
  const now = Date.now();
  const fixture = createFixture({ userCount: 32, now: Math.floor(now / 1000) });
  const users = fixture.registered;
  const top = users[0];
  const boards = arcadeBoards(now);
  const bestLength = '90071992547409931234';
  const totalLength = '90071992547409939999';

  function scoreEntries(game) {
    return Object.fromEntries(users.map((user, index) => [
      user.id, { score: (game === 'dye' ? 90 : 10000) - index, at: now - index }
    ]));
  }

  // More entrants than either board limit makes filtering-before-slicing observable.
  for (const [index, user] of users.entries()) {
    const fish = {
      id: `catch-${index}`, fish_id: 'carp', name: '鲤鱼', rarity: '少见',
      length_cm: index === 0 ? bestLength : 10000 - index,
      caught_at: now - index
    };
    fixture.state.fishing.players[user.id] = {
      best: fish, last_catch: fish, history: [fish], catches: 10,
      total_cm: index === 0 ? totalLength : 20000 - index,
      wallet_cm: 100, gear: { rod: 0, reel: 0, line: 0, bait: 0 }
    };
  }
  for (const { game, mode } of boards) {
    fixture.state.arcade_scores[`${game}:${mode}`] = scoreEntries(game);
  }

  const sessionFor = user => Object.entries(fixture.state.sessions)
    .find(([, session]) => session.user_id === user.id)[0];
  const playerCookie = `${SESSION_COOKIE}=${sessionFor(top)}`;
  const otherCookie = `${SESSION_COOKIE}=${sessionFor(users[1])}`;
  const temporaryRoot = path.resolve(os.tmpdir());
  const dataDir = await fs.mkdtemp(path.join(temporaryRoot, 'ntjv-ban-rankings-'));
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(dataDir)), temporaryRoot);
    assert.ok(path.basename(dataDir).startsWith('ntjv-ban-rankings-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const app = createApp({
    config: {
      isProduction: false, host: '127.0.0.1', port: 0, dataDir,
      seedsDir: path.resolve(__dirname, '../../shared/seeds'),
      publicDir: path.resolve(__dirname, '../../web/public'),
      admin: { password: 'ban-rankings-test', usingGeneratedPassword: false, entryPath: '/ban-rankings-admin.html' },
      cookieSecure: false, ledgerFileName: 'ledger.jsonl'
    },
    logger: { info() {}, warn() {}, error: console.error }
  });
  await app.store.initialize();
  await app.store.replaceState(fixture.state);
  server = startServer(app, { info() {}, warn() {}, error: console.error });
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, pathname, { cookie, body } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(baseUrl + pathname, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }

  const login = await request('POST', '/api/admin/login', { body: { password: 'ban-rankings-test' } });
  assert.equal(login.status, 200);
  const adminCookie = login.headers.get('set-cookie').split(';')[0];

  // Apply the same ban contract to newer modes when this deployment exposes them.
  // Legacy boards are always checked independently of the newer game's support.
  const extraBoards = [];
  for (const mode of ['normal-v2', 'expert-v2', 'lunatic-v2']) {
    const probe = await request('GET', `/api/arcade/leaderboard?game=danmaku&mode=${mode}`);
    assert.ok(probe.status === 200 || probe.status === 400);
    if (probe.status === 200) extraBoards.push({ game: 'danmaku', mode });
  }
  if (extraBoards.length) {
    await app.store.transact(state => {
      for (const { game, mode } of extraBoards) {
        state.arcade_scores[`${game}:${mode}`] = scoreEntries(game);
      }
    });
    boards.push(...extraBoards);
  }

  async function assertFishingBoards(expectedUsers) {
    const expectedNames = expectedUsers.slice(0, 30).map(user => user.display_name);
    const publicBoard = await request('GET', '/api/fishing/leaderboard');
    assert.equal(publicBoard.status, 200);
    assert.equal(publicBoard.headers.get('cache-control'), 'no-store');
    for (const key of ['rows', 'total_rows']) {
      assert.deepEqual(publicBoard.body[key].map(row => row.display_name), expectedNames, key);
      assert.deepEqual(publicBoard.body[key].map(row => row.rank), expectedNames.map((_, index) => index + 1), key);
    }
    const expectedLimit = expectedUsers[0].id === top.id ? (BigInt(bestLength) * 2n).toString() : 50000;
    assert.equal(publicBoard.body.extreme_limit_cm, expectedLimit);
    for (const cookie of [undefined, playerCookie, otherCookie]) {
      const view = await request('GET', '/api/player/fishing/state', { cookie });
      assert.equal(view.status, 200);
      assert.equal(view.headers.get('cache-control'), 'no-store');
      for (const key of ['rows', 'total_rows']) {
        assert.deepEqual(view.body[key].map(row => row.display_name), expectedNames, key);
        assert.deepEqual(view.body[key].map(row => row.rank), expectedNames.map((_, index) => index + 1), key);
      }
    }
  }

  async function assertArcadeBoards(expectedUsers) {
    const expectedNames = expectedUsers.slice(0, 20).map(user => user.display_name);
    for (const { game, mode } of boards) {
      const query = new URLSearchParams({ game, mode });
      const board = await request('GET', `/api/arcade/leaderboard?${query}`);
      assert.equal(board.status, 200, `${game}:${mode}`);
      assert.equal(board.headers.get('cache-control'), 'no-store');
      assert.deepEqual(board.body.rows.map(row => row.display_name), expectedNames, `${game}:${mode}`);
      assert.deepEqual(board.body.rows.map(row => row.rank), expectedNames.map((_, index) => index + 1), `${game}:${mode}`);
    }
  }

  await assertFishingBoards(users);
  await assertArcadeBoards(users);
  const firstBoard = await request('GET', '/api/fishing/leaderboard');
  assert.equal(firstBoard.body.rows[0].length_cm, bestLength);

  const banned = await request('POST', '/api/admin/player', {
    cookie: adminCookie, body: { user_id: top.id, op: 'ban' }
  });
  assert.equal(banned.status, 200);
  assert.equal(banned.body.player_view.banned, true);
  await assertFishingBoards(users.slice(1));
  await assertArcadeBoards(users.slice(1));

  // An already-issued session cannot reinsert the banned player's score.
  for (const [action, body] of [['cast', {}], ['finish', { id: 'catch-0', ticks: 1, controls: [] }]]) {
    const blocked = await request('POST', `/api/player/fishing/${action}`, { cookie: playerCookie, body });
    assert.equal(blocked.status, 403, action);
  }
  for (const board of boards) {
    const submitted = await request('POST', '/api/arcade/score', {
      cookie: playerCookie, body: { ...board, score: 1 }
    });
    assert.equal(submitted.status, 403, `${board.game}:${board.mode}`);
  }

  const unbanned = await request('POST', '/api/admin/player', {
    cookie: adminCookie, body: { user_id: top.id, op: 'unban' }
  });
  assert.equal(unbanned.status, 200);
  assert.equal(unbanned.body.player_view.banned, false);
  await assertFishingBoards(users);
  await assertArcadeBoards(users);
  const restored = await request('GET', '/api/player/fishing/state', { cookie: playerCookie });
  assert.equal(restored.body.best.length_cm, bestLength);
  assert.equal(restored.body.total_cm, totalLength);
  assert.equal(restored.body.wallet_cm, 100);
});
