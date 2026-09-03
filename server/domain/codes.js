'use strict';

/**
 * 注册码（RegistrationCode）领域逻辑。
 * 一个注册码只能绑定一个玩家；绑定后注册码不再是身份凭据。
 */

const { CODE_STATUS, CODE_TYPES } = require('../../shared/constants');
const { generateRegistrationCode } = require('../auth');

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

function findCode(state, code) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return null;
  }
  return state.codes[normalized] || null;
}

function isUsable(codeEntry) {
  return Boolean(
    codeEntry &&
    codeEntry.status === CODE_STATUS.UNUSED &&
    !codeEntry.disabled
  );
}

/**
 * 批量生成注册码。返回本次新增的码列表。
 */
function generateCodes(state, { count, type = CODE_TYPES.ORDINARY, note = '' }, nowSec) {
  const normalizedType = type === CODE_TYPES.SPECIAL ? CODE_TYPES.SPECIAL : CODE_TYPES.ORDINARY;
  const total = Math.floor(Number(count));
  if (!Number.isFinite(total) || total < 1 || total > 5000) {
    return { error: 'BAD_REQUEST', message: '一次需要生成 1～5000 个注册码。' };
  }

  const batchId = `batch_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const created = [];
  let guard = 0;
  while (created.length < total && guard < total * 50) {
    guard += 1;
    const code = generateRegistrationCode();
    if (state.codes[code]) {
      continue;
    }
    state.codes[code] = {
      code,
      type: normalizedType,
      status: CODE_STATUS.UNUSED,
      disabled: false,
      batch_id: batchId,
      note: String(note || '').slice(0, 100),
      bound_user_id: '',
      bound_at: 0,
      created_at: nowSec
    };
    created.push(state.codes[code]);
  }

  if (created.length < total) {
    return { error: 'INTERNAL_ERROR', message: '生成注册码失败：码空间冲突过多，请重试。' };
  }
  return { created, batch_id: batchId };
}

function bindCode(state, codeEntry, userId, nowSec) {
  codeEntry.status = CODE_STATUS.BOUND;
  codeEntry.bound_user_id = userId;
  codeEntry.bound_at = nowSec;
}

function setCodeDisabled(state, code, disabled) {
  const codeEntry = findCode(state, code);
  if (!codeEntry) {
    return { error: 'NOT_FOUND', message: '注册码不存在。' };
  }
  codeEntry.disabled = Boolean(disabled);
  return { codeEntry };
}

/**
 * 管理员为玩家换绑注册码：旧码退役（禁用保留历史），新码必须可用。
 * 票种变化时同步更新基础抽奖权重。返回 { user }，调用方负责写 AdminLog。
 */
function rebindPlayerCode(state, user, newCode, seeds, nowSec) {
  const normalized = normalizeCode(newCode);
  if (!normalized) {
    return { error: 'VALIDATION_FAILED', message: '请输入新的注册码。' };
  }
  const entry = findCode(state, normalized);
  if (!entry) {
    return { error: 'INVALID_CODE', message: '新注册码不存在。' };
  }
  if (entry.disabled) {
    return { error: 'CODE_DISABLED', message: '新注册码已被禁用。' };
  }
  if (!isUsable(entry)) {
    return { error: 'CODE_ALREADY_USED', message: '新注册码已经被使用。' };
  }
  const previousCode = user.code;
  const previousEntry = state.codes[previousCode];
  if (previousEntry) {
    previousEntry.disabled = true;
  }
  bindCode(state, entry, user.id, nowSec);
  user.code = entry.code;
  user.code_type = entry.type;
  const lotteryConfig = seeds.lottery;
  const baseWeight = Number(lotteryConfig.code_type_base_weights[entry.type])
    || lotteryConfig.default_base_weight
    || 1;
  user.weight_base = baseWeight;
  return { user, previous_code: previousCode, new_code: entry.code, new_type: entry.type };
}

/**
 * 查询注册码（管理端）。支持按码 / 绑定者昵称模糊过滤。
 */
function queryCodes(state, { query = '', status = '', type = '', batch_id = '', limit = 200 }, displayNameOf) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const rows = Object.values(state.codes)
    .filter((codeEntry) => {
      if (status && codeEntry.status !== status) {
        return false;
      }
      if (type && codeEntry.type !== type) {
        return false;
      }
      if (batch_id && codeEntry.batch_id !== batch_id) {
        return false;
      }
      if (normalizedQuery) {
        const boundName = codeEntry.bound_user_id ? String(displayNameOf(codeEntry.bound_user_id) || '') : '';
        if (
          !codeEntry.code.toLowerCase().includes(normalizedQuery) &&
          !boundName.toLowerCase().includes(normalizedQuery)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  return {
    total: rows.length,
    rows: rows.slice(0, Math.min(Math.max(1, limit), 2000))
  };
}

function codeSummary(codeEntry, displayNameOf) {
  return {
    code: codeEntry.code,
    type: codeEntry.type,
    status: codeEntry.status,
    disabled: Boolean(codeEntry.disabled),
    batch_id: codeEntry.batch_id,
    note: codeEntry.note,
    bound_user_id: codeEntry.bound_user_id,
    bound_display_name: codeEntry.bound_user_id ? displayNameOf(codeEntry.bound_user_id) : '',
    bound_at: codeEntry.bound_at,
    created_at: codeEntry.created_at
  };
}

function exportRows(state, displayNameOf) {
  return Object.values(state.codes)
    .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
    .map((codeEntry) => ({
      code: codeEntry.code,
      type: codeEntry.type,
      status: codeEntry.status,
      disabled: codeEntry.disabled ? 'yes' : 'no',
      bound_display_name: codeEntry.bound_user_id ? String(displayNameOf(codeEntry.bound_user_id) || '') : '',
      bound_at: codeEntry.bound_at ? new Date(codeEntry.bound_at * 1000).toISOString() : '',
      batch_id: codeEntry.batch_id,
      created_at: new Date(codeEntry.created_at * 1000).toISOString()
    }));
}

module.exports = {
  normalizeCode,
  findCode,
  isUsable,
  generateCodes,
  bindCode,
  setCodeDisabled,
  rebindPlayerCode,
  queryCodes,
  codeSummary,
  exportRows
};
