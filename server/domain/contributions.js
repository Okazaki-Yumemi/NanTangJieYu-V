'use strict';

/**
 * 贡献流水（Contribution Ledger）。
 *
 * 纪律：任何贡献变动（互动 / 管理员 / 节目）都必须产生一条流水，
 * 并同步更新三层聚合：玩家个人、玩家×区域、队伍总贡献。
 *
 * 存储：
 * - state.contribution_log：最近 N 条（有界），供页面快速展示与查询；
 * - data/ledger.jsonl：全量追加式审计日志（事务提交后写入）。
 */

const fs = require('node:fs');
const path = require('node:path');

const { LEDGER_KINDS } = require('../../shared/constants');
const { newId } = require('../auth');

function buildLedgerEntry({
  kind,
  user_id = '',
  team = '',
  region_id = '',
  action_id = '',
  reason = '',
  user_delta = 0,
  team_delta = 0,
  anomaly_delta = 0,
  request_id = '',
  meta = null
}, nowSec) {
  return {
    id: newId('ledger'),
    kind,
    user_id,
    team,
    region_id,
    action_id,
    reason,
    user_delta: Math.floor(user_delta),
    team_delta: Math.floor(team_delta),
    anomaly_delta: Math.floor(anomaly_delta),
    request_id,
    meta,
    created_at: nowSec
  };
}

/**
 * 记录流水并更新聚合。user_delta 不得让个人/队伍贡献为负。
 */
function applyContribution(state, entry) {
  state.contribution_log.push(entry);

  if (entry.user_id && entry.user_delta !== 0) {
    const user = state.users[entry.user_id];
    if (user) {
      user.total_contribution = Math.max(0, user.total_contribution + entry.user_delta);
      if (entry.region_id) {
        const current = Number(user.region_contributions[entry.region_id]) || 0;
        user.region_contributions[entry.region_id] = Math.max(0, current + entry.user_delta);
      }
      user.updated_at = entry.created_at;
    }
  }

  if (entry.team && entry.team_delta !== 0) {
    const team = state.teams[entry.team];
    if (team) {
      team.total_contribution = Math.max(0, team.total_contribution + entry.team_delta);
      team.updated_at = entry.created_at;
    }
  }

  return entry;
}

function trimLedger(state, limit) {
  const bounded = Math.max(50, Number(limit) || 500);
  if (state.contribution_log.length > bounded) {
    state.contribution_log = state.contribution_log.slice(-bounded);
  }
}

function recentForUser(state, userId, limit = 10) {
  return state.contribution_log
    .filter((entry) => entry.user_id === userId)
    .slice(-limit)
    .reverse();
}

function recentGlobal(state, limit = 15) {
  return state.contribution_log.slice(-limit).reverse();
}

function queryLedger(state, { user_id = '', region_id = '', kind = '', limit = 100 } = {}) {
  return state.contribution_log
    .filter((entry) => {
      if (user_id && entry.user_id !== user_id) {
        return false;
      }
      if (region_id && entry.region_id !== region_id) {
        return false;
      }
      if (kind && entry.kind !== kind) {
        return false;
      }
      return true;
    })
    .slice(-limit)
    .reverse();
}

/**
 * 全量审计日志（追加式 JSONL）。事务提交之后调用；
 * state.json 始终是权威数据，这里断行/中断不影响系统正确性。
 */
function appendToLedgerFile(dataDir, fileName, entries) {
  if (!entries || entries.length === 0) {
    return Promise.resolve();
  }
  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n');
  return new Promise((resolve) => {
    fs.appendFile(path.join(dataDir, fileName), `${lines}\n`, 'utf8', (error) => {
      if (error) {
        console.error(`[ledger] 追加审计日志失败: ${error.message}`);
      }
      resolve();
    });
  });
}

/**
 * 读取全量审计日志（导出 / 排查用）。容忍损坏的尾部行。
 */
function readLedgerFile(dataDir, fileName) {
  const filePath = path.join(dataDir, fileName);
  const entries = [];
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return entries;
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // 尾部半行（断电等）直接忽略
    }
  }
  return entries;
}

module.exports = {
  LEDGER_KINDS,
  buildLedgerEntry,
  applyContribution,
  trimLedger,
  recentForUser,
  recentGlobal,
  queryLedger,
  appendToLedgerFile,
  readLedgerFile
};
