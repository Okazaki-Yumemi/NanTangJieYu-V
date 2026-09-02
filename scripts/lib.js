'use strict';

/**
 * 脚本公共引导：加载种子配置并打开状态存储。
 */

const path = require('node:path');

const { createConfig } = require('../server/config');
const { loadSeeds } = require('../server/seed-loader');
const { createStateStore } = require('../server/state-store');
const { buildInitialState, normalizeState } = require('../server/domain/state');

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    }
  }
  return args;
}

function bootScript(overrides = {}) {
  const env = { ...process.env, ...overrides.env };
  const config = createConfig({ env });
  const seeds = loadSeeds(config.seedsDir);
  const store = createStateStore({
    dataDir: config.dataDir,
    createInitialState: () => buildInitialState(seeds),
    normalizeState: (state) => normalizeState(state, seeds),
    logger: console
  });
  return { config, seeds, store };
}

module.exports = {
  parseArgs,
  bootScript
};
