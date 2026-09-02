'use strict';

/**
 * 领域层测试公共夹具：基于真实种子构建状态并注册若干玩家。
 */

const path = require('node:path');
const { loadSeeds } = require('../../server/seed-loader');
const { buildInitialState, normalizeState } = require('../../server/domain/state');
const codes = require('../../server/domain/codes');
const players = require('../../server/domain/players');
const interactions = require('../../server/domain/interactions');
const { ACTIVITY_STATUS } = require('../../shared/constants');

const SEEDS_DIR = path.resolve(__dirname, '../../shared/seeds');

function createFixture({ userCount = 0, now = 1700000000, running = true, rateLimitMs = 0 } = {}) {
  const seeds = loadSeeds(SEEDS_DIR);
  seeds.activity = { ...seeds.activity, interact_rate_limit_ms: rateLimitMs };
  const state = buildInitialState(seeds, now);
  state.activity.status = running ? ACTIVITY_STATUS.RUNNING : ACTIVITY_STATUS.SCHEDULED;

  const registered = [];
  function registerUser(index, team, codeType = 'ordinary') {
    const generation = codes.generateCodes(
      state,
      { count: 1, type: codeType, note: 'fixture' },
      now
    );
    if (generation.error) {
      throw new Error(generation.message);
    }
    const result = players.registerPlayer(
      state,
      {
        code: generation.created[0].code,
        display_name: `测试玩家${index}`,
        password: 'pass1234',
        team
      },
      { seeds },
      now
    );
    if (result.error) {
      throw new Error(result.message);
    }
    registered.push(result.user);
    return result.user;
  }

  for (let index = 1; index <= userCount; index += 1) {
    registerUser(index, index % 2 === 1 ? 'reimu' : 'marisa');
  }

  normalizeState(state, seeds);
  return {
    seeds,
    state,
    now,
    ctx: { seeds, now },
    registered,
    registerUser
  };
}

function performInteract(fixture, user, { regionId, actionId, requestId, now, ...payloadRest } = {}) {
  return interactions.performInteraction(
    fixture.state,
    user,
    {
      region_id: regionId,
      action_id: actionId,
      client_request_id: requestId || `req-${Math.random().toString(36).slice(2, 10)}`,
      ...payloadRest
    },
    { ...fixture.ctx, now: now ?? fixture.now }
  );
}

function interact(fixture, user, overrides = {}) {
  return performInteract(fixture, user, {
    regionId: 'siyuan_gate',
    actionId: 'investigate',
    ...overrides
  });
}

module.exports = {
  createFixture,
  performInteract,
  interact,
  SEEDS_DIR
};
