'use strict';

// 独立服务进程 + 合成数据；只操作 mkdtemp 创建的目录，不访问正式 DATA_DIR。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { parseArgs } = require('./lib');
const args = parseArgs(process.argv);
const root = path.resolve(args.root || path.join(__dirname, '..'));
const users = Number(args.users || 150);
const seconds = Number(args.seconds || 15);
const writeKind = args.writes || 'arcade';

async function worker() {
  const { createApp, startServer } = require(path.join(root, 'server/index'));
  const logger = { info() {}, warn() {}, error: console.error };
  const app = createApp({ logger, config: {
    isProduction: false, host: '127.0.0.1', port: 0, dataDir: args.data,
    seedsDir: path.join(root, 'shared/seeds'), publicDir: path.join(root, 'web/public'),
    admin: { password: 'benchmark-only', usingGeneratedPassword: false, entryPath: '/bench-admin.html' },
    cookieSecure: false, ledgerFileName: 'ledger.jsonl'
  }});
  await app.store.initialize();
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const cpu = process.cpuUsage(); const started = performance.now();
  const server = startServer(app, logger); await once(server, 'listening');
  process.send({ port: server.address().port });
  process.once('message', async () => {
    await new Promise(resolve => server.close(resolve));
    if (app.store.flush) await app.store.flush();
    const elapsed = performance.now() - started; const usage = process.cpuUsage(cpu);
    process.send({ rssMB: Math.round(process.memoryUsage().rss / 1048576), cpuPercent: Math.round((usage.user + usage.system) / elapsed / 10), eventLoopP95ms: Math.round(lag.percentile(95) / 1e6), store: app.store.getMetrics?.() });
    lag.disable(); process.disconnect();
  });
}

async function main() {
  if (!Number.isInteger(users) || users < 1 || users > 500 || !Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw new Error('Use --users 1..500 --seconds 1..300');
  if (!['arcade', 'fx'].includes(writeKind)) throw new Error('Use --writes arcade|fx');
  if (writeKind === 'fx' && seconds * 15 > users * 11) throw new Error('FX scenario must not exceed the 12 initial positions per user');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-benchmark-'));
  let child;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });
  try {
    const { createFixture } = require(path.join(root, 'tests/helpers/fixture'));
    const fx = require(path.join(root, 'server/domain/fx'));
    const f = createFixture({ userCount: users, now: Math.floor(Date.now() / 1000) });
    const now = Date.now();
    // 固定的较重账户：12 笔持仓、30 笔历史。行情及随机新闻不计入性能差异。
    fx.advanceMarket(f.state, now);
    const pairs = fx.view(f.state, null).pairs || [{ id: 'kappa_human' }];
    for (const pair of pairs) {
      const current = pair.id === 'kappa_human' ? f.state.fx.market : f.state.fx.market.pairs[pair.id];
      const price = current.price;
      current.history = Array.from({ length: 180 }, (_, i) => ({ at: now - (179 - i) * 2000, price }));
      current.candles = Array.from({ length: 360 }, (_, i) => ({ at: Math.floor(now / 10000) * 10000 - (359 - i) * 10000, open: price, high: price * 1.01, low: price * .99, close: price }));
      current.tick_candles = Array.from({ length: 180 }, (_, i) => ({ at: Math.floor(now / 2000) * 2000 - (179 - i) * 2000, open: price, high: price * 1.01, low: price * .99, close: price }));
    }
    f.state.fx.market.major_event_ticks = 900;
    f.state.fx.market.updated_at = now + (seconds + 120) * 1000; // 此场景固定报价，另有混合压测覆盖实时行情。
    let seq = 0;
    for (const user of f.registered) {
      const trade = (action, extra = {}) => {
        const result = fx.trade(f.state, user, action, { request_id: `benchmark-${++seq}`, expected_revision: f.state.fx.players[user.id]?.revision || 0, quote_seq: 1, ...extra }, now);
        if (result.error) throw new Error(result.message);
      };
      trade('join');
      for (let i = 0; i < 30; i++) { trade('open', { pair_id: pairs[i % pairs.length].id, side: 'long', margin: 10000, leverage: 1 }); trade('close', { position_id: f.state.fx.players[user.id].positions[0].id }); }
      for (let i = 0; i < 12; i++) trade('open', { pair_id: pairs[i % pairs.length].id, side: 'long', margin: 10000, leverage: 1 });
    }
    const { SESSION_COOKIE } = require(path.join(root, 'shared/constants'));
    const cookies = Object.keys(f.state.sessions).map(id => `${SESSION_COOKIE}=${id}`);
    await fs.writeFile(path.join(dataDir, 'state.json'), JSON.stringify(f.state));
    child = fork(__filename, ['--worker', '--root', root, '--data', dataDir], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const [ready] = await once(child, 'message');
    const timings = { reads: [], writes: [], burst: [] }; let errors = 0; let wireBytes = 0;
    function request(kind, index) {
      const started = performance.now(); const write = kind !== 'reads';
      const tradeNumber = kind === 'burst' ? 0 : 1 + Math.floor(index / users);
      const account = f.state.fx.players[f.registered[index % users].id];
      const body = write ? JSON.stringify(writeKind === 'fx'
        ? { request_id: `load-${kind}-${index}`, expected_revision: account.revision + tradeNumber, quote_seq: 1, position_id: account.positions[tradeNumber].id, pair_id: account.positions[tradeNumber].pair_id }
        : { game: 'puzzle', mode: 'spring', score: kind === 'burst' ? index + 1 : users + index + 1 }) : null;
      return new Promise(resolve => {
        const req = http.request({ host: '127.0.0.1', port: ready.port, agent, method: write ? 'POST' : 'GET',
          path: write ? writeKind === 'fx' ? `/api/fx/close?pair=${pairs[index % pairs.length].id}` : '/api/arcade/score' : index % 4 ? `/api/fx/state?pair=${pairs[index % pairs.length].id}` : '/api/player/state',
          headers: { Cookie: cookies[index % users], 'Accept-Encoding': 'gzip', ...(body ? { 'Content-Type': 'application/json' } : {}) }
        }, res => {
          res.on('data', chunk => { wireBytes += chunk.length; });
          res.on('end', () => { if (res.statusCode !== 200) errors++; timings[kind].push(performance.now() - started); resolve(); });
        });
        req.setTimeout(60000, () => req.destroy(new Error('timeout')));
        req.on('error', () => { errors++; timings[kind].push(performance.now() - started); resolve(); });
        req.end(body);
      });
    }
    const burstStart = performance.now();
    await Promise.all(Array.from({ length: users }, (_, i) => request('burst', i)));
    const burstMs = performance.now() - burstStart;
    const pending = []; let reads = 0; let writes = 0;
    const start = performance.now();
    // 按绝对时间补齐请求，避免 Windows 定时器粒度把 100 req/s 降成 64 req/s。
    function schedule(elapsed) {
      while (reads < Math.floor(elapsed / 10)) pending.push(request('reads', reads++));
      while (writes < Math.floor(elapsed * 15 / 1000)) pending.push(request('writes', writes++));
    }
    const timer = setInterval(() => schedule(Math.min(seconds * 1000, performance.now() - start)), 10);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    clearInterval(timer); schedule(seconds * 1000); await Promise.all(pending);
    const elapsedMs = performance.now() - start;
    const finalMessage = once(child, 'message'); child.send('stop'); const [metrics] = await finalMessage;
    await once(child, 'exit');
    const summary = values => { values.sort((a, b) => a - b); return { count: values.length, p50ms: Math.round(values[Math.floor(values.length * .5)] || 0), p95ms: Math.round(values[Math.floor(values.length * .95)] || 0), p99ms: Math.round(values[Math.floor(values.length * .99)] || 0) }; };
    console.log(JSON.stringify({ users, seconds, writeKind, pairs: pairs.map(pair => pair.id), targetReadRps: 100, targetWriteRps: 15, errors, burstMs: Math.round(burstMs), mixedElapsedMs: Math.round(elapsedMs), wireMB: +(wireBytes / 1e6).toFixed(2), ...Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, summary(v)])), ...metrics }, null, 2));
    if (errors) process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    agent.destroy();
    if (path.dirname(dataDir) !== path.resolve(os.tmpdir()) || !path.basename(dataDir).startsWith('ntjv-benchmark-')) throw new Error('Unexpected temp path');
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}
(args.worker ? worker() : main()).catch(error => { console.error(error); process.exitCode = 1; });
