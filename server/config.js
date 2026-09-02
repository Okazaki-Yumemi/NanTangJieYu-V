'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ADMIN_PASSWORD = 'ntjv-admin';
const DEFAULT_ADMIN_ENTRY_PATH = '/nantang-admin.html';

function parseEnvFile(content) {
  const parsed = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

/**
 * 读取项目根目录 .env（若存在）。
 * 优先级：真实环境变量 > .env 文件 > 默认值。
 */
function loadDotEnv(projectRoot, env = process.env) {
  const envPath = path.join(projectRoot, '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const parsed = parseEnvFile(content);
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === '') {
        env[key] = value;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return env;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function createConfig(options = {}) {
  const env = options.env || process.env;
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..');

  loadDotEnv(projectRoot, env);

  const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const dataDir = path.resolve(
    env.DATA_DIR || path.join(projectRoot, 'data')
  );

  const adminPassword = String(env.ADMIN_PASSWORD || '').trim();
  const adminEntryPath = normalizeEntryPath(
    env.ADMIN_ENTRY_PATH || DEFAULT_ADMIN_ENTRY_PATH
  );

  return {
    projectRoot,
    isProduction,
    host: env.HOST || '0.0.0.0',
    port: Number(env.PORT || 3000),
    dataDir,
    seedsDir: options.seedsDir || path.join(projectRoot, 'shared', 'seeds'),
    publicDir: options.publicDir || path.join(projectRoot, 'web', 'public'),
    admin: {
      password: adminPassword || DEFAULT_ADMIN_PASSWORD,
      usingDefaultPassword: !adminPassword,
      entryPath: adminEntryPath
    },
    cookieSecure: toBool(env.COOKIE_SECURE, isProduction),
    ledgerFileName: 'ledger.jsonl'
  };
}

function normalizeEntryPath(entryPath) {
  let normalized = String(entryPath || DEFAULT_ADMIN_ENTRY_PATH).trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  return normalized;
}

function validateRuntimeConfig(config, logger = console) {
  const problems = [];
  if (config.isProduction && config.admin.usingDefaultPassword) {
    problems.push(
      '生产环境（NODE_ENV=production）必须通过 ADMIN_PASSWORD 设置管理员口令。'
    );
  }
  if (config.admin.usingDefaultPassword) {
    logger.warn(
      '[config] 正在使用默认管理员口令，仅限本地开发使用。正式活动请设置 ADMIN_PASSWORD。'
    );
  }
  if (config.admin.entryPath === '/admin.html' || config.admin.entryPath === '/nantang-admin.html') {
    logger.warn(
      '[config] 管理员入口使用了常见路径，正式活动建议改为随机路径（ADMIN_ENTRY_PATH）。'
    );
  }
  return problems;
}

module.exports = {
  createConfig,
  loadDotEnv,
  parseEnvFile,
  validateRuntimeConfig
};
