'use strict';

// 全站混合负载：仅绑定回环地址，使用独立 .scratch 目录；不读取正式 DATA_DIR。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { gunzipSync } = require('node:zlib');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { parseArgs } = require('./lib');
const args = parseArgs(process.argv);
const root = path.resolve(__dirname, '..');
const runDir = path.resolve(args.dir || path.join(root, '.scratch', `mixed150-${Date.now()}`));
if (!runDir.startsWith(path.join(root, '.scratch') + path.sep)) throw new Error('Test data must be inside project/.scratch/');
fs.mkdirSync(runDir, { recursive: true });
const port = Number(args.port || 3147);
const seconds = Number(args.seconds || 180);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isFinite(seconds) || seconds < 10 || seconds > 1800) throw new Error('Invalid port/duration');
const ADMIN_PASSWORD = 'mixed-local-test-only';
const PLAYER_PASSWORD = 'loadtest1234';
const distribution = { fx: 40, campus: 35, fishing: 25, danmaku: 20, puzzle: 15, dye: 15 };

async function serve() {
  const { createApp, startServer } = require('../server');
  const app = createApp({ logger: { info: console.log, warn() {}, error: console.error }, config: {
    isProduction: false, host: '127.0.0.1', port, dataDir: path.join(runDir, 'data'),
    seedsDir: path.join(root, 'shared/seeds'), publicDir: path.join(root, 'web/public'),
    admin: { password: ADMIN_PASSWORD, usingGeneratedPassword: false, entryPath: '/loadtest-admin.html' },
    cookieSecure: false, ledgerFileName: 'ledger.jsonl'
  }});
  await app.store.initialize();
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const phases = []; let current;
  const memory = () => ({ rssMiB: process.memoryUsage().rss / 1048576, heapMiB: process.memoryUsage().heapUsed / 1048576 });
  function begin(name) {
    if (current) phases.push(snapshot());
    lag.reset(); current = { name, started: performance.now(), cpu: process.cpuUsage(), peakRssMiB: memory().rssMiB, peakHeapMiB: memory().heapMiB, samples: 0 };
  }
  function snapshot() {
    const elapsedMs = performance.now() - current.started; const cpu = process.cpuUsage(current.cpu);
    return { name: current.name, elapsedMs, cpuOneCorePercent: (cpu.user + cpu.system) / elapsedMs / 10,
      peakRssMiB: current.peakRssMiB, peakHeapMiB: current.peakHeapMiB, rssEndMiB: memory().rssMiB,
      eventLoopP95ms: lag.percentile(95) / 1e6, eventLoopMaxMs: lag.max / 1e6, samples: current.samples };
  }
  function summary() {
    const state = app.store.getLatest();
    return { users: Object.keys(state.users).length, boundCodes: Object.values(state.codes).filter(c => c.bound_user_id).length,
      teams: Object.fromEntries(Object.entries(state.teams).map(([k,v]) => [k, { members: v.member_count, contribution: v.total_contribution }])),
      contributions: Object.values(state.users).reduce((sum, u) => sum + u.total_contribution, 0),
      fxAccounts: Object.keys(state.fx.players).length,
      fxPositions: Object.values(state.fx.players).reduce((sum, a) => sum + a.positions.length, 0),
      fxOrders: Object.values(state.fx.players).reduce((sum, a) => sum + a.requests.length, 0),
      fishingAccounts: Object.keys(state.fishing.players).length,
      fishCaught: Object.values(state.fishing.players).reduce((sum, a) => sum + (a.catches || 0), 0),
      boards: Object.fromEntries(Object.entries(state.arcade_scores).map(([k, v]) => [k, Object.keys(v).length])),
      ledgerEntries: state.contribution_log.length, stateBytes: fs.statSync(app.store.getPaths().stateFile).size };
  }
  begin('startup');
  const sampler = setInterval(() => {
    const mem = memory(); current.peakRssMiB = Math.max(current.peakRssMiB, mem.rssMiB);
    current.peakHeapMiB = Math.max(current.peakHeapMiB, mem.heapMiB); current.samples++;
    if (current.samples % 5 === 0) fs.appendFile(path.join(runDir, 'samples.jsonl'), JSON.stringify({ at: Date.now(), phase: current.name, ...mem, ...app.store.getMetrics() }) + '\n', () => {});
  }, 200); sampler.unref();
  let server;
  function json(res, value) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
  server = startServer({ ...app, requestHandler: async (req, res) => {
    if (req.url.startsWith('/__loadtest/')) {
      if (req.url.startsWith('/__loadtest/phase?')) { begin(new URL(req.url, 'http://localhost').searchParams.get('name')); return json(res, { ok: true }); }
      if (req.url === '/__loadtest/summary') return json(res, summary());
      if (req.url === '/__loadtest/metrics') return json(res, { phases: [...phases, snapshot()], nativePeakRssMiB: process.resourceUsage().maxRSS / 1024, store: app.store.getMetrics(), pid: process.pid });
      if (req.url === '/__loadtest/stop') {
        json(res, { ok: true }); clearInterval(sampler);
        return server.close(async () => { await app.store.flush(); process.exit(0); });
      }
      res.writeHead(404); return res.end();
    }
    return app.requestHandler(req, res);
  }}, { info: console.log, warn() {}, error: console.error });
  await once(server, 'listening');
  fs.writeFileSync(path.join(runDir, 'server.json'), JSON.stringify({ pid: process.pid, port, runDir }));
}

async function exercise() {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 300 });
  let phase = 'setup'; const statistics = {}; const failures = []; let seq = 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function request(route, { body, cookie = '', category = '', allow = [], method = body ? 'POST' : 'GET' } = {}) {
    const started = performance.now(); const name = `${phase}:${category || (body ? 'write' : 'read')}`;
    const payload = body ? JSON.stringify(body) : null;
    return new Promise(resolve => {
      let done = false;
      const finish = (status, headers, bytes, error) => {
        if (done) return; done = true;
        let data = null; let decoded = bytes;
        try { if (headers['content-encoding'] === 'gzip') decoded = gunzipSync(bytes); data = JSON.parse(decoded.toString('utf8')); } catch {}
        const allowed = allow.includes(data?.error);
        const row = statistics[name] ||= { times: [], bytes: 0, errors: 0, businessRejections: {} };
        row.times.push(performance.now() - started); row.bytes += bytes.length;
        if (allowed) row.businessRejections[data.error] = (row.businessRejections[data.error] || 0) + 1;
        if (error || status < 200 || status >= 400) {
          if (!allowed) { row.errors++; if (failures.length < 40) failures.push({ phase, route, status, error: error?.message || data?.error || 'HTTP error' }); }
        }
        resolve({ status, data, text: decoded.toString('utf8'), cookie: headers['set-cookie']?.map(c => c.split(';')[0]).join('; ') || '' });
      };
      const req = http.request({ host: '127.0.0.1', port, path: route, method, agent,
        headers: { Cookie: cookie, 'Accept-Encoding': 'gzip', ...(payload ? { 'Content-Type': 'application/json' } : {}) }
      }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => finish(res.statusCode, res.headers, Buffer.concat(chunks)));
        res.on('error', error => finish(0, {}, Buffer.alloc(0), error));
      });
      req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
      req.on('error', error => finish(0, {}, Buffer.alloc(0), error)); req.end(payload);
    });
  }
  async function setPhase(name) { await request(`/__loadtest/phase?name=${encodeURIComponent(name)}`, { category: 'control' }); phase = name; console.log(`PHASE ${name}`); }
  const groups = Object.entries(distribution).flatMap(([group, count]) => Array(count).fill(group));
  const actors = groups.map((group, i) => ({ index: i, group, name: `压测${String(i + 1).padStart(3, '0')}`, cookie: '', count: 0 }));
  const pages = { fx: '/fx.html', campus: '/', fishing: '/fishing.html', danmaku: '/danmaku.html', puzzle: '/puzzle.html', dye: '/dye.html' };
  let admin;
  try {
    admin = (await request('/api/admin/login', { body: { password: ADMIN_PASSWORD } })).cookie;
    if (!admin) throw new Error('Test admin login failed');
    const generated = await request('/api/admin/codes/generate', { cookie: admin, body: { count: 150, type: 'ordinary', note: 'isolated mixed load test' } });
    if (generated.data?.codes?.length !== 150) throw new Error('Code generation failed');
    await request('/api/admin/activity', { cookie: admin, body: { action: 'start' } });

    await setPhase('cold-pages');
    await Promise.all(actors.map(async actor => {
      const html = await request(pages[actor.group], { category: 'html' });
      const assets = [...new Set([...html.text.matchAll(/(?:src|href)="(\/[^"#]+)"/g)].map(match => match[1]).filter(url => /\.(js|css|png|jpg|jpeg|svg|webp)(\?|$)/.test(url)))];
      for (let start = 0; start < assets.length; start += 6) await Promise.all(assets.slice(start, start + 6).map(url => request(url, { category: 'asset' })));
    }));
    await setPhase('register-150');
    await Promise.all(actors.map(async (actor, i) => {
      const r = await request('/api/player/register', { category: 'registration', body: { code: generated.data.codes[i], display_name: actor.name, password: PLAYER_PASSWORD, team: i % 2 ? 'marisa' : 'reimu' } });
      if (r.status !== 200) throw new Error(`Registration ${i}: ${r.data?.error}`); actor.cookie = r.cookie;
    }));
    await setPhase('login-150');
    await Promise.all(actors.map(async actor => {
      const r = await request('/api/player/login', { category: 'login', body: { display_name: actor.name, password: PLAYER_PASSWORD } });
      if (r.status !== 200) throw new Error(`Login: ${r.data?.error}`); actor.cookie = r.cookie;
    }));
    await setPhase('prepare-games');
    await Promise.all(actors.filter(a => a.group === 'fx').map(actor => request('/api/fx/join', { cookie: actor.cookie, body: { request_id: `mixed-join-${actor.index}`, expected_revision: 0 }, category: 'fx-join' })));
    const fishingGame = require('../web/public/fishing-game');
    function replay(challenge) {
      const state = fishingGame.createGame(challenge); const controls = []; let last = false;
      while (state.status === 'playing') {
        const held = state.y + state.velocity * .13 > fishingGame.fishPosition(state.tick + 5, challenge);
        if (held !== last) { controls.push({ tick: state.tick, held }); last = held; }
        fishingGame.step(state, held, challenge);
      }
      return { controls, ticks: state.tick };
    }
    const dateMode = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const danmakuMode = fs.readFileSync(path.join(root, 'web/public/danmaku.js'), 'utf8').includes('-v2') ? 'normal-v2' : 'normal';
    function board(actor) { return actor.group === 'danmaku' ? danmakuMode : actor.group === 'puzzle' ? 'spring' : dateMode; }
    async function play(actor, elapsed) {
      const cookie = actor.cookie;
      if (actor.group === 'fx') {
        const pair = ['kappa_human', 'moon_human', 'tengu_human', 'nether_human', 'kappa_moon'][actor.index % 5];
        const q = await request(`/api/fx/state?pair=${pair}`, { cookie, category: 'fx-read' });
        const state = q.data; if (!state?.account) return;
        if (elapsed >= (actor.nextAction || 0)) {
          actor.nextAction = elapsed + 8000;
          const close = state.account.positions.length >= 3 || (actor.count++ % 2 && state.account.positions.length);
          const body = { request_id: `mixed-order-${++seq}`, expected_revision: state.account.revision,
            ...(close ? { position_id: state.account.positions[0].id, pair_id: state.account.positions[0].pair_id, quote_seq: state.market.seq } : { pair_id: pair, side: actor.index % 2 ? 'short' : 'long', margin: 10000, leverage: 1, quote_seq: state.market.seq }) };
          await request(`/api/fx/${close ? 'close' : 'open'}?pair=${pair}`, { cookie, category: 'fx-trade', body, allow: ['STALE_QUOTE', 'CONFLICT'] });
        }
      } else if (actor.group === 'campus') {
        const r = await request('/api/player/state', { cookie, category: 'campus-read' });
        const state = r.data?.state; if (!state) return;
        const region = state.regions.find(item => ['available', 'investigating'].includes(item.status) && !item.closed);
        if (region && state.me.energy > 0 && elapsed >= (actor.nextAction || 0)) {
          actor.nextAction = elapsed + 20000;
          await request('/api/player/interact', { cookie, category: 'campus-task', body: { region_id: region.id, action_id: 'investigate', client_request_id: `mixed-task-${++seq}` }, allow: ['REGION_CLEARED', 'ENERGY_NOT_ENOUGH'] });
        }
      } else if (actor.group === 'fishing') {
        const r = await request('/api/player/fishing/state', { cookie, category: 'fishing-read' });
        if (actor.attempt && Date.now() >= actor.finishAt) {
          const finished = await request('/api/player/fishing/finish', { cookie, category: 'fishing-finish', body: actor.attempt });
          if (finished.status !== 200) throw new Error(`Fishing replay rejected: ${finished.data?.error}`);
          actor.attempt = null;
          await request('/api/fishing/leaderboard', { cookie, category: 'fishing-board' });
        } else if (!actor.attempt && r.data && Date.now() >= r.data.next_cast_at) {
          const cast = await request('/api/player/fishing/cast', { cookie, category: 'fishing-cast', body: { rhythm: true } });
          if (cast.data?.challenge) {
            const trace = replay(cast.data.challenge);
            actor.attempt = { id: cast.data.challenge.id, ...trace };
            actor.finishAt = Date.now() + trace.ticks * fishingGame.DT * 1000 + 100;
          }
        }
      } else {
        const mode = board(actor);
        await request(`/api/arcade/leaderboard?game=${actor.group}&mode=${mode}`, { cookie, category: `${actor.group}-board` });
        if (elapsed >= (actor.nextAction || 0)) {
          actor.nextAction = elapsed + 30000; actor.count++;
          const score = actor.group === 'puzzle' ? 99900 + Math.min(actor.count, 90) : actor.group === 'dye' ? 70 + Math.min(actor.count, 25) : 500 + actor.count * 100;
          await request('/api/arcade/score', { cookie, category: `${actor.group}-score`, body: { game: actor.group, mode, score } });
        }
      }
    }
    await setPhase('mixed-150');
    const started = performance.now(); const deadline = started + seconds * 1000;
    const durationByGroup = { fx: 2000, campus: 6000, fishing: 2000, danmaku: 10000, puzzle: 10000, dye: 10000 };
    await Promise.all(actors.map(async actor => {
      let due = started + (actor.index * 97) % durationByGroup[actor.group];
      while (due < deadline) {
        await sleep(Math.max(0, due - performance.now()));
        await play(actor, performance.now() - started);
        due = Math.max(due + durationByGroup[actor.group], performance.now());
      }
      if (actor.attempt) {
        await sleep(Math.max(0, actor.finishAt - Date.now()));
        await request('/api/player/fishing/finish', { cookie: actor.cookie, category: 'fishing-finish', body: actor.attempt });
      }
    }));
    await setPhase('burst-150');
    await Promise.all(actors.map(actor => request('/api/arcade/score', { cookie: actor.cookie, category: 'simultaneous-score', body: { game: 'puzzle', mode: 'winter', score: 99900 - actor.index } })));
    await setPhase('verify');
    const summary = (await request('/__loadtest/summary', { category: 'control' })).data;
    if (summary.users !== 150 || summary.boundCodes !== 150 || summary.fxAccounts !== 40 || summary.fishingAccounts !== 25 || summary.boards['puzzle:winter'] !== 150) throw new Error('Final user/account/score counts differ');
    const persisted = JSON.parse(fs.readFileSync(path.join(runDir, 'data/state.json')));
    if (Object.keys(persisted.users).length !== 150 || Object.keys(persisted.arcade_scores['puzzle:winter']).length !== 150) throw new Error('Persistence check failed');
    const metrics = (await request('/__loadtest/metrics', { category: 'control' })).data;
    const quantiles = row => {
      row.times.sort((a, b) => a - b);
      const q = value => +row.times[Math.min(row.times.length - 1, Math.ceil(row.times.length * value) - 1)].toFixed(2);
      return { requests: row.times.length, errors: row.errors, businessRejections: row.businessRejections, p50ms: q(.5), p95ms: q(.95), p99ms: q(.99), maxMs: q(1), responseMB: +(row.bytes / 1e6).toFixed(3) };
    };
    const report = { createdAt: new Date().toISOString(), runDir, url: `http://127.0.0.1:${port}`, durationSeconds: seconds, distribution,
      host: { node: process.version, cpu: os.cpus()[0].model.trim(), logicalCPUs: os.cpus().length, totalMemoryGiB: +(os.totalmem() / 1073741824).toFixed(1), platform: os.platform(), release: os.release() },
      statistics: Object.fromEntries(Object.entries(statistics).map(([key, row]) => [key, quantiles(row)])), failures, metrics, summary,
      notes: ['HTTP virtual users, not 150 graphical browsers', 'Fishing uses actual timed control replays; other client-side games submit legal simulated results', 'External map-guessing website excluded', 'FX actors are spread across five currency pairs with live shared quotes'] };
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
    await setPhase('idle-after-test');
    console.log(JSON.stringify({ report: path.join(runDir, 'report.json'), errors: failures.length, summary, nativePeakRssMiB: metrics.nativePeakRssMiB }, null, 2));
    if (Object.values(statistics).some(row => row.errors)) process.exitCode = 1;
  } finally { agent.destroy(); }
}
(args.server ? serve() : exercise()).catch(error => { console.error(error); process.exitCode = 1; });
