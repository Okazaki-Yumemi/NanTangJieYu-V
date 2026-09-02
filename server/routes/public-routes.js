'use strict';

/**
 * 公开只读 API（大屏 / 排行榜展示）。无会话、无写入。
 */

const { sendJson } = require('../http-utils');
const views = require('../views');

function registerRoutes(router, appCtx) {
  const { seeds, store } = appCtx;

  router.get('/api/public/state', async (req, res) => {
    try {
      const state = store.getLatest();
      sendJson(res, 200, views.buildPublicState(state, seeds));
    } catch (error) {
      console.error('[public] 构建公开状态失败:', error);
      sendJson(res, 500, { error: 'INTERNAL_ERROR', message: '状态读取失败。' });
    }
  });
}

module.exports = { registerRoutes };
