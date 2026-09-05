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
    return total % 60 === 0 ? `${minutes} 分钟` : `${minutes} 分 ${total % 60} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} 小时` : `${hours} 时 ${minutes % 60} 分`;
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

/**
 * 动态背景：黑色基底上的五色光晕（对应五个季节色）缓慢漂移 + 漂浮光点。
 * 纯 CSS 动画（仅 transform/opacity），三端页面共用。
 */
NTJ.injectBackdrop = function injectBackdrop() {
  if (document.getElementById('ntj-backdrop')) {
    return;
  }
  const wrap = document.createElement('div');
  wrap.id = 'ntj-backdrop';
  wrap.setAttribute('aria-hidden', 'true');

  for (let index = 1; index <= 5; index += 1) {
    const blob = document.createElement('i');
    blob.className = `ntj-blob ntj-blob-${index}`;
    wrap.appendChild(blob);
  }

  const particles = document.createElement('div');
  particles.className = 'ntj-particles';
  for (let index = 0; index < 34; index += 1) {
    const dot = document.createElement('i');
    dot.style.setProperty('--x', (Math.random() * 100).toFixed(2) + '%');
    dot.style.setProperty('--y', (Math.random() * 100).toFixed(2) + '%');
    dot.style.setProperty('--d', (9 + Math.random() * 16).toFixed(2) + 's');
    dot.style.setProperty('--t', (2.4 + Math.random() * 5).toFixed(2) + 's');
    dot.style.setProperty('--s', (1.5 + Math.random() * 3).toFixed(2) + 'px');
    dot.style.setProperty('--delay', (-Math.random() * 20).toFixed(2) + 's');
    particles.appendChild(dot);
  }
  wrap.appendChild(particles);
  document.body.prepend(wrap);
};

NTJ.SEASON_STYLES = {
  spring: { label: '春', color: '#ff7fa3', soft: 'rgba(255,127,163,0.18)' },
  summer: { label: '夏', color: '#4ade80', soft: 'rgba(74,222,128,0.16)' },
  autumn: { label: '秋', color: '#ffb454', soft: 'rgba(255,180,84,0.18)' },
  winter: { label: '冬', color: '#6ab7ff', soft: 'rgba(106,183,255,0.16)' },
  chaos: { label: '乱', color: '#b287ff', soft: 'rgba(178,135,255,0.18)' },
  final: { label: '终', color: '#ffd166', soft: 'rgba(255,209,102,0.16)' }
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

NTJ.characterImage = function characterImage(characterId) {
  return `/assets/characters/${NTJ.escapeHtml(characterId)}.png`;
};

NTJ.injectBackdrop();

window.NTJ = NTJ;
