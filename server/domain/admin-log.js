'use strict';

/**
 * 管理操作审计日志。所有管理员动作必须经过这里留痕。
 */

const { newId } = require('../auth');

const ADMIN_LOG_LIMIT = 5000;

function logAdminAction(state, action, detail, nowSec) {
  const entry = {
    id: newId('adminlog'),
    action,
    detail: detail || {},
    created_at: nowSec
  };
  state.admin_logs.push(entry);
  if (state.admin_logs.length > ADMIN_LOG_LIMIT) {
    state.admin_logs = state.admin_logs.slice(-ADMIN_LOG_LIMIT);
  }
  return entry;
}

function recentAdminLogs(state, limit = 30) {
  return state.admin_logs.slice(-limit).reverse();
}

module.exports = {
  logAdminAction,
  recentAdminLogs
};
