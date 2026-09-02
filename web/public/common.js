'use strict';

/**
 * 前端公共工具（无依赖）。
 */

const NTJ = {};

NTJ.HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

NTJ.escapeHtml = function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => NTJ.HTML_ESCAPE_MAP[char]);
};

NTJ.formatNumber = function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
};

NTJ.formatDuration = function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) {
    return `${total} 秒`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes} 分 ${total % 60} 秒`;
  }
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
};

NTJ.formatTime = function formatTime(epochSeconds) {
  if (!epochSeconds) {
    return '';
  }
  const date = new Date(epochSeconds * 1000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/**
 * API 请求封装。网络错误 / 非 2xx 统一抛出 {error, message}。
 */
NTJ.api = async function api(method, pathname, body) {
  let response;
  try {
    response = await fetch(pathname, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
  } catch {
    throw { error: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试。' };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw (payload && payload.error)
      ? payload
      : { error: 'HTTP_ERROR', message: `请求失败（${response.status}）` };
  }
  return payload;
};

NTJ.newRequestId = function newRequestId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

NTJ.toast = function toast(message, kind = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => item.classList.add('show'), 10);
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 300);
  }, 2800);
};

NTJ.polling = function polling(fn, intervalMs) {
  let timer = null;
  let stopped = false;
  async function tick() {
    if (stopped) {
      return;
    }
    try {
      await fn();
    } catch (error) {
      // 轮询失败不打断页面，等待下一轮
    }
  }
  function schedule() {
    timer = setTimeout(async () => {
      await tick();
      schedule();
    }, intervalMs);
  }
  schedule();
  tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    }
  };
};

NTJ.ACTIVITY_STATUS_LABELS = {
  scheduled: '未开始',
  running: '进行中',
  paused: '已暂停',
  ended: '已结束'
};

NTJ.REGION_STATUS_LABELS = {
  locked: '未解锁',
  available: '可调查',
  investigating: '调查中',
  cleared: '已解决'
};

NTJ.SEASON_STYLES = {
  spring: { label: '春', color: '#e26a86', soft: '#fbe7ec' },
  summer: { label: '夏', color: '#2e9e5b', soft: '#e2f5e8' },
  autumn: { label: '秋', color: '#d8862a', soft: '#fcefdb' },
  winter: { label: '冬', color: '#4a7fb5', soft: '#e3edf9' },
  chaos: { label: '乱', color: '#8a5cc4', soft: '#efe7fa' },
  final: { label: '终', color: '#b8860b', soft: '#f8f0d8' }
};

NTJ.characterImage = function characterImage(characterId) {
  return `/assets/characters/${NTJ.escapeHtml(characterId)}.png`;
};

window.NTJ = NTJ;
