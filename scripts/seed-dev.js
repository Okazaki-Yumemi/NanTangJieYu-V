'use strict';

/**
 * 生成开发用种子数据：20 个测试玩家 + 若干贡献记录 + 推进部分区域。
 * 仅用于本地开发预览，正式活动前请勿在正式数据目录执行。
 *
 * 用法：node scripts/seed-dev.js
 */

const { bootScript } = require('./lib');
const codes = require('../server/domain/codes');
const players = require('../server/domain/players');
const interactions = require('../server/domain/interactions');
const contributions = require('../server/domain/contributions');
const regions = require('../server/domain/regions');
const { ACTIVITY_STATUS } = require('../shared/constants');

const NAMES = [
  '紫音', '星轨', '银月', '绯樱', '苍叶', '雪见', '辰砂', '翠雨', '雷光', '澄风',
  '暮蝉', '萤火', '霞光', '琉璃', '琥珀', '霜华', '竹影', '花灯', '夜想', '晨曦'
];

async function main() {
  const { seeds, store } = bootScript();
  await store.initialize();

  const now = Math.floor(Date.now() / 1000);
  const password = 'dev1234';

  await store.transact((state) => {
    state.activity.status = ACTIVITY_STATUS.RUNNING;
    state.activity.started_at = now;

    const generated = codes.generateCodes(state, { count: NAMES.length, type: 'ordinary', note: 'dev-seed' }, now);
    if (generated.error) {
      return store.abort(generated);
    }

    const users = [];
    for (const [index, codeEntry] of generated.created.entries()) {
      const name = `测试-${NAMES[index]}`;
      const registered = players.registerPlayer(
        state,
        {
          code: codeEntry.code,
          display_name: name,
          password,
          team: index % 2 === 0 ? 'reimu' : 'marisa'
        },
        { seeds },
        now
      );
      if (registered.error) {
        return store.abort(registered);
      }
      users.push(registered.user);
    }

    // 模拟一部分互动：思源门推进过半，其他区域少量尝试
    const plan = [
      { region: 'siyuan_gate', actions: ['investigate', 'ask_reimu', 'ask_marisa', 'patrol', 'deep_scan'] },
      { region: 'siyuan_lake', actions: ['investigate', 'lake_netting'] }
    ];
    let requestSeq = 0;
    let tick = now - 3600;
    for (const user of users) {
      for (const { region, actions } of plan) {
        for (const action of actions) {
          if (state.regions[region].cleared) {
            break;
          }
          const outcome = interactions.performInteraction(
            state,
            user,
            { region_id: region, action_id: action, client_request_id: `seed-${requestSeq}` },
            { seeds, now: tick }
          );
          requestSeq += 1;
          if (!outcome.error) {
            contributions.trimLedger(state, seeds.activity.ledger_recent_limit);
          }
          tick += 90;
          if (tick > now) {
            tick = now;
          }
        }
      }
    }

    // 涵泽湖做一次节目式演示：强制解锁留待管理员，不影响默认流程
    return { users: users.length };
  });

  const state = store.getLatest();
  const reimu = state.teams.reimu;
  const marisa = state.teams.marisa;
  console.log('开发种子数据已写入。');
  console.log(`  玩家：${Object.keys(state.users).length} 人（灵梦队 ${reimu.member_count} / 魔理沙队 ${marisa.member_count}）`);
  console.log(`  灵梦队总贡献 ${reimu.total_contribution}，魔理沙队总贡献 ${marisa.total_contribution}`);
  for (const region of seeds.regions) {
    const runtime = state.regions[region.id];
    console.log(`  ${region.name}: ${runtime.anomaly_remaining}/${region.max_anomaly}（${runtime.cleared ? '已解决' : regions.isRegionUnlocked(state, region) ? '已解锁' : '未解锁'}）`);
  }
  console.log(`  测试玩家密码统一为：${password}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
