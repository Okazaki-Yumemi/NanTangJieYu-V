'use strict';

/**
 * HTTP 工具：JSON 收发、Cookie、静态资源、轻量路由。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_JSON_BODY_BYTES = 64 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': contentType, ...extraHeaders });
  res.end(text);
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      if (raw.length + chunk.length > MAX_JSON_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || '';
  for (const item of cookie.split(';')) {
    const trimmed = item.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return '';
}

function setSessionCookie(res, name, value, { secure }) {
  const attributes = [`Path=/`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) {
    attributes.push('Secure');
  }
  res.setHeader('Set-Cookie', `${name}=${value}; ${attributes.join('; ')}`);
}

function clearSessionCookie(res, name, { secure }) {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) {
    attributes.push('Secure');
  }
  res.setHeader('Set-Cookie', `${name}=; ${attributes.join('; ')}`);
}

function resolvePublicFilePath(publicDir, routePath) {
  let relativePath = '';
  try {
    relativePath = decodeURIComponent(routePath).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const filePath = path.resolve(publicDir, relativePath);
  const relativeToPublic = path.relative(publicDir, filePath);
  if (relativeToPublic.startsWith('..') || path.isAbsolute(relativeToPublic)) {
    return null;
  }
  return filePath;
}

function serveStatic(res, pathname, { publicDir, adminEntryPath }) {
  let routePath = pathname === '/' ? '/index.html' : pathname;
  if (adminEntryPath && routePath === adminEntryPath) {
    routePath = '/admin.html';
  }
  if (routePath === '/admin.html' && routePath !== adminEntryPath) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const filePath = resolvePublicFilePath(publicDir, routePath);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }
  if (!stat || stat.isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
  if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.woff2'].includes(ext)) {
    headers['Cache-Control'] = 'public, max-age=3600';
  } else if (['.html', '.css', '.js'].includes(ext)) {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

/**
 * 极简路由表：支持 GET/POST 与 /path/:param。
 */
function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      `^${String(pattern)
        .split('/')
        .map((segment) => {
          if (segment.startsWith(':')) {
            keys.push(segment.slice(1));
            return '([^/]+)';
          }
          return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/')}$`
    );
    routes.push({ method, regex, keys, handler });
  }

  async function dispatch(req, res, pathname, context) {
    for (const route of routes) {
      if (route.method !== req.method) {
        continue;
      }
      const match = route.regex.exec(pathname);
      if (!match) {
        continue;
      }
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1]);
      });
      await route.handler(req, res, { ...context, params });
      return true;
    }
    return false;
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    dispatch
  };
}

module.exports = {
  sendJson,
  sendText,
  collectBody,
  getCookie,
  setSessionCookie,
  clearSessionCookie,
  serveStatic,
  createRouter
};
