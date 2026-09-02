'use strict';

/**
 * 单实例 JSON 状态存储。
 *
 * - 每个事务串行化执行：读取 -> 变更 -> 原子写盘（主文件 + 备份）。
 * - 主文件损坏时自动从备份恢复；两者都不可用时拒绝启动，绝不静默重建。
 * - 事务提交后更新内存中的最新状态引用，供只读接口使用（getLatest）。
 * - snapshotBeforeCommit 可在重置等危险操作前落一份独立快照。
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ABORT = Symbol('state-store-abort');

function abortTransaction(result) {
  return { [ABORT]: true, result };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
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
  directoryFsyncPlatform = process.platform
}) {
  const paths = {
    dataDir: path.resolve(dataDir),
    stateFile: path.join(path.resolve(dataDir), 'state.json'),
    backupFile: path.join(path.resolve(dataDir), 'state.json.bak')
  };
  let writeTail = Promise.resolve();
  let latestState = null;

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
      await handle.writeFile(serializeState(state), 'utf8');
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

  async function loadPrimaryForWrite() {
    const primary = await tryParseJsonFile(paths.stateFile);
    if (primary.value) {
      return normalize(primary.value);
    }

    const backup = await tryParseJsonFile(paths.backupFile);
    if (backup.value) {
      await restorePrimaryFromBackup(backup.value, primary.error ? primary.error.message : 'primary file is missing');
      return normalize(backup.value);
    }

    if (primary.exists || backup.exists) {
      throw new Error(
        `State recovery failed. Primary: ${paths.stateFile} (${primary.error ? primary.error.message : 'missing'}). ` +
        `Backup: ${paths.backupFile} (${backup.error ? backup.error.message : 'missing'}).`
      );
    }
    throw new Error(`State file is missing: ${paths.stateFile}`);
  }

  async function initialize() {
    await ensureDataDir();
    const primary = await tryParseJsonFile(paths.stateFile);
    const backup = await tryParseJsonFile(paths.backupFile);

    if (!primary.exists && !backup.exists) {
      const initial = normalize(createInitialState()).state;
      await atomicWrite(paths.stateFile, initial);
      await atomicWrite(paths.backupFile, initial);
      latestState = initial;
      return;
    }

    if (!primary.value) {
      if (backup.value) {
        await restorePrimaryFromBackup(backup.value, primary.error ? primary.error.message : 'primary file is missing');
        const normalized = normalize(backup.value);
        if (normalized.changed) {
          await atomicWrite(paths.stateFile, normalized.state);
        }
        latestState = normalized.state;
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
    latestState = normalized.state;
  }

  async function readState() {
    const state = await parseJsonFile(paths.stateFile);
    return cloneJson(state);
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

  async function commit(currentState, nextState) {
    // 先写备份（内容来自本次事务成功解析的状态），再替换主文件。
    await atomicWrite(paths.backupFile, currentState);
    await atomicWrite(paths.stateFile, nextState);
    latestState = nextState;
  }

  function transact(mutator, options = {}) {
    const operation = writeTail.then(async () => {
      const loaded = await loadPrimaryForWrite();
      const currentState = loaded.state;
      const draft = cloneJson(currentState);
      const outcome = await mutator(draft);
      if (outcome && outcome[ABORT]) {
        return outcome.result;
      }
      const normalized = normalize(draft).state;
      if (options.snapshotBeforeCommit) {
        await writeSnapshot(currentState, options.snapshotLabel);
      }
      await commit(currentState, normalized);
      return outcome;
    });
    writeTail = operation.catch(() => undefined);
    return operation;
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
    replaceState,
    transact
  };
}

module.exports = { createStateStore, isUnsupportedDirectoryFsyncError, cloneJson, abortTransaction, ABORT };
