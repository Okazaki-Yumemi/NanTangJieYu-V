'use strict';

/**
 * 单实例 JSON 状态存储。
 *
 * - 单进程内存快照、串行事务、有限批次原子写盘（主文件 + 备份）。
 * - 同批事务按顺序执行，成功结果在整批 fsync 完成后才返回。
 * - 主文件损坏时自动从备份恢复；两者都不可用时拒绝启动，绝不静默重建。
 * - 事务提交后更新内存中的最新状态引用，供只读接口使用（getLatest）。
 * - snapshotBeforeCommit 可在重置等危险操作前落一份独立快照。
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { publish } = require('./state-cache');
const { setImmediate: yieldTurn } = require('node:timers/promises');

const ABORT = Symbol('state-store-abort');

function abortTransaction(result) {
  return { [ABORT]: true, result };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeState(state) {
  return `${JSON.stringify(state)}\n`;
}

function isUnsupportedDirectoryFsyncError(error) {
  return Boolean(error && ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code));
}

function createStateStore({
  dataDir,
  createInitialState,
  normalizeState,
  logger = console,
  directorySync,
  directoryFsyncPlatform = process.platform,
  maxBatchSize = 16,
  maxPending = 512
}) {
  const paths = {
    dataDir: path.resolve(dataDir),
    stateFile: path.join(path.resolve(dataDir), 'state.json'),
    backupFile: path.join(path.resolve(dataDir), 'state.json.bak')
  };
  let latestState = null;
  let latestSerialized = null;
  let scheduled = false;
  let fatalWriteError = null;
  let directorySyncUnsupported = false;
  const queue = [];
  const idleWaiters = [];
  const metrics = { pending: 0, peakPending: 0, commits: 0, transactions: 0 };
  maxBatchSize = Math.max(1, Math.floor(maxBatchSize) || 16);
  maxPending = Math.max(maxBatchSize, Math.floor(maxPending) || 512);

  function setLatest(state, serialized = serializeState(state)) {
    latestSerialized = serialized;
    latestState = publish(state);
  }

  async function ensureDataDir() {
    await fs.mkdir(paths.dataDir, { recursive: true });
  }

  async function parseJsonFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid state object in ${filePath}`);
    }
    return parsed;
  }

  async function tryParseJsonFile(filePath) {
    try {
      return { exists: true, value: await parseJsonFile(filePath), error: null };
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { exists: false, value: null, error: null };
      }
      return { exists: true, value: null, error };
    }
  }

  function normalize(state) {
    const before = JSON.stringify(state);
    const normalized = normalizeState ? normalizeState(state) : state;
    const nextState = normalized || state;
    return { state: nextState, changed: JSON.stringify(nextState) !== before };
  }

  async function syncDirectory() {
    if (directorySyncUnsupported) return;
    let handle;
    try {
      if (directorySync) {
        await directorySync(paths.dataDir);
        return;
      }
      handle = await fs.open(paths.dataDir, 'r');
      await handle.sync();
    } catch (error) {
      // Windows 常见情况下拒绝目录 fsync；文件本身的 fsync 已完成。
      if (directoryFsyncPlatform === 'win32' || isUnsupportedDirectoryFsyncError(error)) {
        directorySyncUnsupported = true;
        logger.warn(`Could not fsync state directory ${paths.dataDir}: ${error.message}`);
        return;
      }
      throw error;
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
    }
  }

  async function atomicWrite(targetPath, state) {
    const tempPath = path.join(
      paths.dataDir,
      `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    let handle;
    try {
      handle = await fs.open(tempPath, 'w', 0o600);
      await handle.writeFile(typeof state === 'string' ? state : serializeState(state), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(tempPath, targetPath);
      await syncDirectory();
    } finally {
      if (handle) {
        await handle.close().catch(() => {});
      }
      await fs.unlink(tempPath).catch(() => {});
    }
  }

  function createSnapshotPath(label) {
    const safeLabel = String(label || 'snapshot')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'snapshot';
    const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
    const suffix = crypto.randomBytes(6).toString('hex');
    return path.join(
      paths.dataDir,
      `state.${safeLabel}-${timestamp}-${process.pid}-${suffix}.json`
    );
  }

  async function writeSnapshot(state, label) {
    const snapshotPath = createSnapshotPath(label);
    await atomicWrite(snapshotPath, state);
    return snapshotPath;
  }

  async function restorePrimaryFromBackup(backupState, reason) {
    logger.warn(`Recovering ${paths.stateFile} from ${paths.backupFile}: ${reason}`);
    await atomicWrite(paths.stateFile, backupState);
  }

  async function initialize() {
    await ensureDataDir();
    const primary = await tryParseJsonFile(paths.stateFile);
    const backup = await tryParseJsonFile(paths.backupFile);

    if (!primary.exists && !backup.exists) {
      const initial = normalize(createInitialState()).state;
      await atomicWrite(paths.stateFile, initial);
      await atomicWrite(paths.backupFile, initial);
      setLatest(initial);
      return;
    }

    if (!primary.value) {
      if (backup.value) {
        await restorePrimaryFromBackup(backup.value, primary.error ? primary.error.message : 'primary file is missing');
        const normalized = normalize(backup.value);
        if (normalized.changed) {
          await atomicWrite(paths.stateFile, normalized.state);
        }
        setLatest(normalized.state);
        return;
      }
      throw new Error(
        `State recovery failed. Primary: ${paths.stateFile} (${primary.error ? primary.error.message : 'missing'}). ` +
        `Backup: ${paths.backupFile} (${backup.error ? backup.error.message : 'missing'}).`
      );
    }

    const normalized = normalize(primary.value);
    if (normalized.changed) {
      await atomicWrite(paths.backupFile, primary.value);
      await atomicWrite(paths.stateFile, normalized.state);
    } else if (!backup.value) {
      // 主文件已验证有效时，才允许重建缺失的备份。
      await atomicWrite(paths.backupFile, primary.value);
    }
    setLatest(normalized.state);
  }

  async function readState() {
    return cloneJson(getLatest());
  }

  /**
   * 返回最近一次提交的状态引用（只读！调用方不得修改，
   * 只读视图构建函数应基于它生成新对象）。
   */
  function getLatest() {
    if (!latestState) {
      throw new Error('State store is not initialized');
    }
    return latestState;
  }

  async function commit(nextState) {
    const serialized = serializeState(nextState);
    // 备份是上一批已确认快照；复用序列化结果，避免再次遍历整个状态。
    await atomicWrite(paths.backupFile, latestSerialized);
    await atomicWrite(paths.stateFile, serialized);
    setLatest(nextState, serialized);
    metrics.commits++;
  }

  async function drain() {
    while (queue.length) {
      const batch = [queue.shift()];
      // 需要独立快照的管理操作作为屏障，避免合并前后的重置操作。
      if (!batch[0].options.snapshotBeforeCommit) {
        while (batch.length < maxBatchSize && queue.length && !queue[0].options.snapshotBeforeCommit) batch.push(queue.shift());
      }
      let working = latestState;
      const outcomes = [];
      let persistenceError = fatalWriteError;
      if (!persistenceError) {
        for (const item of batch) {
          try {
            const draft = cloneJson(working);
            const outcome = await item.mutator(draft);
            if (outcome && outcome[ABORT]) outcomes.push({ value: outcome.result });
            else { working = draft; outcomes.push({ value: outcome }); }
          } catch (error) { outcomes.push({ error }); }
          // 大账户批次也让出事件循环，读请求和健康检查无需等待整批计算。
          await yieldTurn();
        }
        if (working !== latestState) {
          try {
            const normalized = normalizeState ? normalizeState(working) || working : working;
            if (batch[0].options.snapshotBeforeCommit) await writeSnapshot(latestState, batch[0].options.snapshotLabel);
            await commit(normalized);
          } catch (error) {
            // 写盘失败后结果可能不确定，停止接收后续写入，重启走主备恢复。
            persistenceError = fatalWriteError = error;
          }
        }
      }
      batch.forEach((item, index) => {
        metrics.pending--;
        const error = persistenceError || outcomes[index]?.error;
        if (error) item.reject(error); else item.resolve(outcomes[index].value);
      });
    }
    scheduled = false;
    idleWaiters.splice(0).forEach(resolve => resolve());
  }

  function transact(mutator, options = {}) {
    if (!latestState) return Promise.reject(new Error('State store is not initialized'));
    if (fatalWriteError) return Promise.reject(fatalWriteError);
    if (metrics.pending >= maxPending) return Promise.reject(Object.assign(new Error('Write queue is full'), { code: 'SERVER_BUSY' }));
    const operation = new Promise((resolve, reject) => queue.push({ mutator, options, resolve, reject }));
    metrics.transactions++;
    metrics.peakPending = Math.max(metrics.peakPending, ++metrics.pending);
    if (!scheduled) { scheduled = true; setImmediate(() => { void drain(); }); }
    return operation;
  }

  function flush() {
    return scheduled ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve();
  }

  function replaceState(nextState) {
    return transact((draft) => {
      Object.keys(draft).forEach((key) => delete draft[key]);
      Object.assign(draft, cloneJson(nextState));
    });
  }

  return {
    abort: abortTransaction,
    getPaths: () => ({ ...paths }),
    initialize,
    readState,
    getLatest,
    flush,
    getMetrics: () => ({ ...metrics, writeBlocked: Boolean(fatalWriteError) }),
    replaceState,
    transact
  };
}

module.exports = { createStateStore, isUnsupportedDirectoryFsyncError, cloneJson, abortTransaction, ABORT };
