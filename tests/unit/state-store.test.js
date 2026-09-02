'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createStateStore, cloneJson } = require('../../server/state-store');

async function createTempStore(t, { normalizeState } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  return createStateStore({
    dataDir,
    createInitialState: () => ({ counters: {}, items: [] }),
    normalizeState
  });
}

test('store initializes and persists across re-open', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const first = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: { visits: 0 } })
  });
  await first.initialize();
  await first.transact((state) => {
    state.counters.visits += 1;
    return { ok: true };
  });

  const second = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: { visits: 0 } })
  });
  await second.initialize();
  assert.equal(second.getLatest().counters.visits, 1);
});

test('transaction serializes writes and updates getLatest', async (t) => {
  const store = await createTempStore(t);
  await store.initialize();

  await Promise.all([
    store.transact((state) => {
      state.counters.a = (state.counters.a || 0) + 1;
      return { which: 'a' };
    }),
    store.transact((state) => {
      state.counters.b = (state.counters.b || 0) + 1;
      return { which: 'b' };
    }),
    store.transact((state) => {
      state.counters.c = (state.counters.c || 0) + 1;
      return { which: 'c' };
    })
  ]);

  const latest = store.getLatest();
  assert.equal(latest.counters.a, 1);
  assert.equal(latest.counters.b, 1);
  assert.equal(latest.counters.c, 1);
});

test('aborted transactions leave no state changes', async (t) => {
  const store = await createTempStore(t);
  await store.initialize();

  const outcome = await store.transact((state) => {
    state.counters.touched = true;
    return store.abort({ error: 'NOPE', message: '拒绝' });
  });

  assert.deepEqual(outcome, { error: 'NOPE', message: '拒绝' });
  assert.ok(!('touched' in store.getLatest().counters));
});

test('normalizeState runs on load and initialize', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await fs.writeFile(
    path.join(dataDir, 'state.json'),
    JSON.stringify({ legacy: true }),
    'utf8'
  );
  await fs.writeFile(
    path.join(dataDir, 'state.json.bak'),
    JSON.stringify({ legacy: true }),
    'utf8'
  );

  const store = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: {} }),
    normalizeState: (state) => {
      state.normalized = true;
      delete state.legacy;
      return state;
    }
  });
  await store.initialize();
  assert.deepEqual(store.getLatest(), { normalized: true });
});

test('corrupt primary recovers from backup', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const seed = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: { good: 42 } })
  });
  await seed.initialize();

  await fs.writeFile(path.join(dataDir, 'state.json'), '{corrupt', 'utf8');

  const recovered = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: {} })
  });
  await recovered.initialize();
  assert.equal(recovered.getLatest().counters.good, 42);
  const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(onDisk.counters.good, 42);
});

test('both files corrupt refuses to start', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  await fs.writeFile(path.join(dataDir, 'state.json'), 'bad', 'utf8');
  await fs.writeFile(path.join(dataDir, 'state.json.bak'), 'bad', 'utf8');

  const store = createStateStore({
    dataDir,
    createInitialState: () => ({})
  });
  await assert.rejects(() => store.initialize(), /State recovery failed/);
});

test('snapshotBeforeCommit writes an independent snapshot file', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ntjv-store-'));
  t.after(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const store = createStateStore({
    dataDir,
    createInitialState: () => ({ counters: { v: 1 } })
  });
  await store.initialize();

  await store.transact((state) => {
    state.counters.v = 2;
    return { ok: true };
  }, { snapshotBeforeCommit: true, snapshotLabel: 'reset' });

  const files = await fs.readdir(dataDir);
  const snapshots = files.filter((name) => name.startsWith('state.reset-'));
  assert.equal(snapshots.length, 1);
  const snapshot = JSON.parse(await fs.readFile(path.join(dataDir, snapshots[0]), 'utf8'));
  assert.equal(snapshot.counters.v, 1);
  assert.equal(store.getLatest().counters.v, 2);
});

test('cloneJson deep clones', () => {
  const source = { a: { b: [1, 2] } };
  const cloned = cloneJson(source);
  cloned.a.b.push(3);
  assert.deepEqual(source.a.b, [1, 2]);
});
