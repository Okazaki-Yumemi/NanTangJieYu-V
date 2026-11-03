'use strict';

/**
 * HTTP 集成测试：以真实服务 + 临时数据目录走完整用户旅程。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { after, before, describe, it } = require('node:test');

const { createApp, startServer } = require('../../server/index');

process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.ADMIN_ENTRY_PATH = '/test-admin-entry.html';
process.env.NODE_ENV = 'test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntjv-integration-'));

const app = createApp({
  transformSeeds(seeds) {
    // 集成测试连续请求，关闭进程内限流（限流逻辑已在单元测试覆盖）
    seeds.activity.interact_rate_limit_ms = 0;
  },
  config: {
    isProduction: false,
    host: '127.0.0.1',
    port: 0,
    dataDir,
    seedsDir: path.resolve(__dirname, '../../shared/seeds'),
    publicDir: path.resolve(__dirname, '../../web/public'),
    admin: { password: 'test-admin-password', usingGeneratedPassword: false, entryPath: '/test-admin-entry.html' },
    cookieSecure: false,
    ledgerFileName: 'ledger.jsonl'
  }
});

let server = null;
let baseUrl = '';

function request(method, pathname, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const url = new URL(pathname, baseUrl);
    const req = http.request(url, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json: parsed, text: raw });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function extractCookies(res) {
  const setCookies = res.headers['set-cookie'] || [];
  return setCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

before(async () => {
  await app.store.initialize();
  server = startServer(app, { info: () => {}, warn: () => {}, error: console.error });
  await new Promise((resolve) => server.on('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsPromises.rm(dataDir, { recursive: true, force: true });
});

describe('HTTP integration: full event journey', () => {
  let adminCookie = '';
  let playerACookie = '';
  let playerBCookie = '';
  let codeA = '';
  let codeB = '';

  it('healthz responds without touching state', async () => {
    const res = await request('GET', '/healthz');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
  });

  it('admin login issues a session cookie', async () => {
    const bad = await request('POST', '/api/admin/login', { body: { password: 'wrong' } });
    assert.equal(bad.status, 401);

    const res = await request('POST', '/api/admin/login', { body: { password: 'test-admin-password' } });
    assert.equal(res.status, 200);
    adminCookie = extractCookies(res);
    assert.ok(adminCookie.includes('ntjy_admin='));
  });

  it('admin generates registration codes and exports csv', async () => {
    const gen = await request('POST', '/api/admin/codes/generate', {
      body: { count: 5, type: 'ordinary', note: 'integration' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(gen.status, 200, gen.text);
    codeA = gen.json.codes[0];
    codeB = gen.json.codes[1];
    assert.match(codeA, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);

    const list = await request('GET', '/api/admin/codes?query=&limit=10', { headers: { Cookie: adminCookie } });
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 5);

    const csv = await request('GET', '/api/admin/codes/export', { headers: { Cookie: adminCookie } });
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes('code,type,status'));
    assert.ok(csv.text.includes(codeA));
  });

  it('rejects admin endpoints without session', async () => {
    const res = await request('GET', '/api/admin/bootstrap');
    assert.equal(res.status, 401);
  });

  it('player registers with a code, picks a team and receives home state', async () => {
    const res = await request('POST', '/api/player/register', {
      body: { code: codeA, display_name: '旅行者A', password: 'pass1234', team: 'reimu' }
    });
    assert.equal(res.status, 200, res.text);
    playerACookie = extractCookies(res);
    assert.ok(res.json.state.me);
    assert.equal(res.json.state.me.team, 'reimu');
    assert.equal(res.json.state.me.total_contribution, 0);
    assert.equal(res.json.state.activity.status, 'scheduled');
    assert.equal(res.json.state.regions.length, 6);
    // 未解锁区域的奖品应显示为神秘奖品
    const mystery = res.json.state.prizes.filter((prize) => !prize.available);
    assert.ok(mystery.length > 0);
    assert.ok(mystery.every((prize) => prize.name === '神秘奖品'));
  });

  it('same code cannot register twice; nickname unique', async () => {
    const reuse = await request('POST', '/api/player/register', {
      body: { code: codeA, display_name: '旅行者B', password: 'pass1234', team: 'marisa' }
    });
    assert.equal(reuse.status, 400);
    assert.equal(reuse.json.error, 'CODE_ALREADY_USED');

    const dup = await request('POST', '/api/player/register', {
      body: { code: codeB, display_name: '旅行者A', password: 'pass1234', team: 'marisa' }
    });
    assert.equal(dup.status, 400);
    assert.equal(dup.json.error, 'DUPLICATE_DISPLAY_NAME');
  });

  it('player B registers and re-logs in with credentials', async () => {
    const res = await request('POST', '/api/player/register', {
      body: { code: codeB, display_name: '旅行者B', password: 'pass1234', team: 'marisa' }
    });
    assert.equal(res.status, 200);
    playerBCookie = extractCookies(res);

    const again = await request('POST', '/api/player/login', {
      body: { display_name: '旅行者B', password: 'pass1234' }
    });
    assert.equal(again.status, 200);
  });

  it('interaction is blocked before the activity starts', async () => {
    const res = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_gate', action_id: 'investigate', client_request_id: 'early-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'ACTIVITY_NOT_RUNNING');
  });

  it('admin starts the activity', async () => {
    const res = await request('POST', '/api/admin/activity', {
      body: { action: 'start' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.admin.activity.status, 'running');
  });

  it('player interacts: contribution, anomaly and ledger all move', async () => {
    const before = await request('GET', '/api/player/state', { headers: { Cookie: playerACookie } });
    const anomalyBefore = before.json.state.regions[0].anomaly_remaining;

    const res = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_gate', action_id: 'investigate', client_request_id: 'journey-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.action_result.contribution_gain > 0);
    assert.ok(res.json.action_result.anomaly_reduction > 0);
    assert.equal(res.json.state.me.total_contribution, res.json.action_result.contribution_gain);
    assert.equal(
      res.json.state.regions[0].anomaly_remaining,
      anomalyBefore - res.json.action_result.anomaly_reduction
    );

    // 幂等：重复提交同一 client_request_id 不重复计分
    const repeat = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_gate', action_id: 'investigate', client_request_id: 'journey-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.json.duplicate, true);
    assert.equal(repeat.json.state.me.total_contribution, res.json.state.me.total_contribution);
  });

  it('interaction refreshes session activity so sliding TTL does not drop active players', async () => {
    const sessionId = playerACookie.split('=')[1];
    const readLastSeen = () => {
      const state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
      return state.sessions[sessionId].last_seen_at;
    };
    const before = readLastSeen();
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const res = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_gate', action_id: 'investigate', client_request_id: 'session-refresh-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(res.status, 200, res.text);
    assert.ok(readLastSeen() >= before + 1, 'interact should advance the session last_seen_at');
  });

  it('locked region and foreign-team interaction are rejected', async () => {
    const locked = await request('POST', '/api/player/interact', {
      body: { region_id: 'admin_building', action_id: 'investigate', client_request_id: 'locked-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(locked.status, 400);
    assert.equal(locked.json.error, 'REGION_LOCKED');

    const restricted = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_gate', action_id: 'ask_marisa', client_request_id: 'team-1' },
      headers: { Cookie: playerACookie }
    });
    assert.equal(restricted.status, 400);
    assert.equal(restricted.json.error, 'INTERACTION_UNAVAILABLE');
  });

  it('admin force-clears the first region: next unlocks, prize reveals', async () => {
    const res = await request('POST', '/api/admin/region', {
      body: { region_id: 'siyuan_gate', op: 'force_clear' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(res.status, 200, res.text);
    const region = res.json.admin.regions.find((item) => item.id === 'siyuan_gate');
    assert.equal(region.status, 'cleared');
    const next = res.json.admin.regions.find((item) => item.id === 'siyuan_lake');
    assert.equal(next.status, 'available');

    const player = await request('GET', '/api/player/state', { headers: { Cookie: playerACookie } });
    const revealed = player.json.state.prizes.find((prize) => prize.source === 'siyuan_gate');
    assert.equal(revealed.available, true);
    assert.notEqual(revealed.name, '神秘奖品');
  });

  it('region leaderboard reflects contributions', async () => {
    const res = await request('GET', '/api/player/leaderboard/siyuan_gate');
    assert.equal(res.status, 200);
    assert.ok(res.json.rows.length >= 1);
    assert.equal(res.json.rows[0].rank, 1);
  });

  it('admin adjusts contribution with ledger entry; player view updates', async () => {
    const before = await request('GET', '/api/admin/bootstrap', { headers: { Cookie: adminCookie } });
    const player = before.json.admin.players[0];

    const res = await request('POST', '/api/admin/player', {
      body: { user_id: player.id, op: 'adjust_contribution', amount: 500, reason: '舞台补发' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.player_view.total_contribution, player.total_contribution + 500);

    const ledger = await request('GET', `/api/admin/ledger?user_id=${player.id}&limit=10`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(ledger.status, 200);
    assert.ok(ledger.json.rows.some((row) => row.kind === 'admin' && row.user_delta === 500));
  });

  it('base prize draw works with the prize-specific repeat-winner policy', async () => {
    const first = await request('POST', '/api/admin/lottery/draw', {
      body: { prize_id: 'prize_base_bookmark' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(first.status, 200, first.text);
    const drawId = first.json.draw.id;

    // 新流程：抽出后需先「确认有效」才能标记领取
    const premature = await request('POST', '/api/admin/lottery/record', {
      body: { draw_id: drawId, op: 'claim' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(premature.status, 400);

    const confirmed = await request('POST', '/api/admin/lottery/record', {
      body: { draw_id: drawId, op: 'confirm' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(confirmed.status, 200, confirmed.text);

    const claimed = await request('POST', '/api/admin/lottery/record', {
      body: { draw_id: drawId, op: 'claim' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(claimed.status, 200);

    const locked = await request('POST', '/api/admin/lottery/draw', {
      body: { prize_id: 'prize_admin_building' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(locked.status, 400);
    assert.equal(locked.json.error, 'PRIZE_LOCKED');
  });

  it('admin can ban and unban a player', async () => {
    const boot = await request('GET', '/api/admin/bootstrap', { headers: { Cookie: adminCookie } });
    const target = boot.json.admin.players.find((p) => p.display_name === '旅行者B');

    const banned = await request('POST', '/api/admin/player', {
      body: { user_id: target.id, op: 'ban' },
      headers: { Cookie: adminCookie }
    });
    assert.equal(banned.status, 200);
    assert.equal(banned.json.player_view.banned, true);

    const blocked = await request('POST', '/api/player/interact', {
      body: { region_id: 'siyuan_lake', action_id: 'investigate', client_request_id: 'ban-1' },
      headers: { Cookie: playerBCookie }
    });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.json.error, 'USER_BANNED');

    await request('POST', '/api/admin/player', {
      body: { user_id: target.id, op: 'unban' },
      headers: { Cookie: adminCookie }
    });
  });

  it('display endpoint serves public state without session', async () => {
    const res = await request('GET', '/api/public/state');
    assert.equal(res.status, 200);
    assert.ok(res.json.teams.length === 2);
    assert.ok(res.json.regions.length === 6);
    assert.ok(res.json.top_players.length >= 1);
    assert.ok(res.json.prize_track.some((prize) => prize.available));
  });

  it('fishing enforces authentication, persistent cooldown, replay validation and safe naming', async () => {
    const noAuth=await request('POST','/api/player/fishing/cast',{body:{}});
    assert.equal(noAuth.status,401);
    const cast=await request('POST','/api/player/fishing/cast',{body:{rhythm:true},headers:{Cookie:playerACookie}});
    assert.equal(cast.status,200);
    const challenge=cast.json.challenge;
    assert.equal(challenge.rhythm,true);
    const again=await request('POST','/api/player/fishing/cast',{body:{},headers:{Cookie:playerACookie}});
    assert.equal(again.status,429);
    const core=require('../../web/public/fishing-game');
    // 隔离测试中的时间提前，避免真的等待收杆；正式接口不接受客户端时钟。
    await app.store.transact(state=>{
      const attempt=Object.values(state.fishing.players).find(item=>item.attempt.id===challenge.id).attempt;
      attempt.created_at-=45000;attempt.difficulty=.2;attempt.length_cm=350;
      return {ok:true};
    });
    const config={...challenge,difficulty:.2};
    const game=core.createGame(config);const controls=[];let last=false;
    while(game.status==='playing') {
      const held=game.y+game.velocity*.2>core.fishPosition(game.tick+10,config);
      if(held!==last){controls.push({tick:game.tick,held});last=held;}
      core.step(game,held,config);
    }
    const saved=await request('POST','/api/player/fishing/finish',{body:{id:challenge.id,ticks:game.tick,controls},headers:{Cookie:playerACookie}});
    assert.equal(saved.status,200);assert.equal(saved.json.result.caught,true);
    const named=await request('POST','/api/player/fishing/name',{body:{id:challenge.id,name:'湖边大王'},headers:{Cookie:playerACookie}});
    assert.equal(named.status,200);
    const forbidden=await request('POST','/api/player/fishing/name',{body:{id:challenge.id,name:'色 情'},headers:{Cookie:playerACookie}});
    assert.equal(forbidden.status,400);
    const ranks=await request('GET','/api/fishing/leaderboard');
    assert.equal(ranks.json.rows[0].custom_name,'湖边大王');
    const purchase=await request('POST','/api/player/fishing/upgrade',{body:{gear_id:'rod',expected_level:0},headers:{Cookie:playerACookie}});
    assert.equal(purchase.status,200);
    assert.equal(purchase.json.wallet_cm,150);
    const repeated=await request('POST','/api/player/fishing/upgrade',{body:{gear_id:'rod',expected_level:0},headers:{Cookie:playerACookie}});
    assert.equal(repeated.status,400);
    const fishingState=await request('GET','/api/player/fishing/state',{headers:{Cookie:playerACookie}});
    assert.equal(fishingState.json.total_cm,350);
    assert.equal(fishingState.json.wallet_cm,150);
    assert.equal(fishingState.json.gear.rod,1);
    assert.equal(fishingState.json.total_rows[0].total_cm,350);
  });

  it('arcade leaderboards require login to submit and retain the best score per mode', async () => {
    const body = { game: 'danmaku', mode: 'normal', score: 310 };
    const headers = { Cookie: playerACookie };
    assert.equal((await request('POST', '/api/arcade/score', { body })).status, 401);
    assert.equal((await request('POST', '/api/arcade/score', { body: { ...body, mode: '__proto__' }, headers })).status, 400);
    assert.equal((await request('POST', '/api/arcade/score', { body: { ...body, score: 20001 }, headers })).status, 400);
    assert.equal((await request('POST', '/api/arcade/score', { body, headers })).json.improved, true);
    assert.equal((await request('POST', '/api/arcade/score', { body: { ...body, score: 240 }, headers })).json.best, 310);
    assert.equal((await request('POST', '/api/arcade/score', { body: { ...body, score: 420 }, headers })).json.improved, true);
    const board = await request('GET', '/api/arcade/leaderboard?game=danmaku&mode=normal');
    assert.deepEqual(board.json.rows.map(({ rank, score }) => ({ rank, score })), [{ rank: 1, score: 420 }]);
    const expert = await request('GET', '/api/arcade/leaderboard?game=danmaku&mode=expert');
    assert.deepEqual(expert.json.rows, []);
  });

  it('restart keeps the state (persistence)', async () => {
    const stateBefore = (await request('GET', '/api/public/state')).json;
    await new Promise((resolve) => server.close(resolve));
    server = null;

    const restartedApp = createApp({
      config: app.config
    });
    await restartedApp.store.initialize();
    server = startServer(restartedApp, { info: () => {}, warn: () => {}, error: console.error });
    await new Promise((resolve) => server.on('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const stateAfter = (await request('GET', '/api/public/state')).json;
    assert.equal(stateAfter.activity.player_count, stateBefore.activity.player_count);
    assert.equal(stateAfter.activity.status, 'running');
    const gate = stateAfter.regions.find((region) => region.id === 'siyuan_gate');
    assert.equal(gate.status, 'cleared');
    const fishingState=await request('GET','/api/player/fishing/state',{headers:{Cookie:playerACookie}});
    assert.ok(fishingState.json.cooldown_sec>0);
    assert.equal(fishingState.json.best.custom_name,'湖边大王');
    assert.equal(fishingState.json.gear.rod,1);
    assert.equal(fishingState.json.wallet_cm,150);
  });

  it('ledger file records the audit trail', async () => {
    const ledgerPath = path.join(dataDir, 'ledger.jsonl');
    const content = await fsPromises.readFile(ledgerPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 2);
    const first = JSON.parse(lines[0]);
    assert.ok(first.id && first.kind);
  });
});
