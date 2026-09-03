'use strict';

/**
 * 东方南堂界遇 V —— 服务入口。
 *
 * 零第三方依赖的单实例 Node.js HTTP 服务：
 * - shared/seeds/*.json 提供活动规则（修改后重启生效）；
 * - data/state.json 保存运行时状态（原子写盘 + 备份恢复）；
 * - data/ledger.jsonl 追加式贡献审计日志。
 */

const http = require('node:http');

const { createConfig, validateRuntimeConfig } = require('./config');
const { loadSeeds } = require('./seed-loader');
const { createStateStore } = require('./state-store');
const { buildInitialState, normalizeState } = require('./domain/state');
const { createRouter, serveStatic } = require('./http-utils');
const playerRoutes = require('./routes/player-routes');
const adminRoutes = require('./routes/admin-routes');
const publicRoutes = require('./routes/public-routes');

function createApp(overrides = {}) {
  const config = overrides.config || createConfig({ env: overrides.env });
  const logger = overrides.logger || console;

  for (const problem of validateRuntimeConfig(config, logger)) {
    logger.error(`[config] ${problem}`);
    return { configError: problem };
  }

  const seeds = loadSeeds(config.seedsDir);
  if (typeof overrides.transformSeeds === 'function') {
    overrides.transformSeeds(seeds);
  }
  const store = createStateStore({
    dataDir: config.dataDir,
    createInitialState: () => buildInitialState(seeds),
    normalizeState: (state) => normalizeState(state, seeds),
    logger
  });

  const router = createRouter();
  const appCtx = { config, seeds, store };

  publicRoutes.registerRoutes(router, appCtx);
  playerRoutes.registerRoutes(router, appCtx);
  adminRoutes.registerRoutes(router, appCtx);

  async function requestHandler(req, res) {
    let pathname = '/';
    let query = new URLSearchParams();
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      pathname = url.pathname;
      query = url.searchParams;
    } catch {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    if (pathname === '/healthz') {
      // 健康检查不读取状态，不产生会话
      const { sendJson } = require('./http-utils');
      sendJson(res, 200, { status: 'ok', timestamp: Date.now() });
      return;
    }

    if (!pathname.startsWith('/api/')) {
      serveStatic(res, pathname, {
        publicDir: config.publicDir,
        adminEntryPath: config.admin.entryPath
      });
      return;
    }

    try {
      const handled = await router.dispatch(req, res, pathname, { ...appCtx, query });
      if (!handled) {
        const { sendJson } = require('./http-utils');
        sendJson(res, 404, { error: 'NOT_FOUND', message: '接口不存在。' });
      }
    } catch (error) {
      logger.error('[server] 未处理的请求错误:', error);
      if (!res.headersSent) {
        const { sendJson } = require('./http-utils');
        sendJson(res, 500, { error: 'INTERNAL_ERROR', message: '服务器内部错误。' });
      } else {
        res.end();
      }
    }
  }

  return { config, seeds, store, router, requestHandler };
}

function startServer(app, logger = console) {
  const server = http.createServer(app.requestHandler);
  server.listen(app.config.port, app.config.host, () => {
    logger.info(`东方南堂界遇 V 服务已启动: http://${app.config.host}:${app.config.port}`);
    logger.info(`管理员入口: http://${app.config.host}:${app.config.port}${app.config.admin.entryPath}`);
    logger.info(`数据目录: ${app.config.dataDir}`);
  });
  return server;
}

if (require.main === module) {
  const app = createApp();
  if (app.configError) {
    process.exitCode = 1;
  } else {
    app.store
      .initialize()
      .then(() => {
        startServer(app);
      })
      .catch((error) => {
        const paths = app.store.getPaths();
        console.error(`状态存储初始化失败。主文件: ${paths.stateFile}，备份: ${paths.backupFile}。`);
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { createApp, startServer };
