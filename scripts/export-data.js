'use strict';

/**
 * 活动数据导出（赛后存档 / 排查）。
 *
 * 用法：node scripts/export-data.js [--out exports]
 * 产出：players.csv / codes.csv / contributions.csv（全量流水） / lottery.csv / summary.json
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, bootScript } = require('./lib');
const contributions = require('../server/domain/contributions');
const lottery = require('../server/domain/lottery');

function toCsv(rows) {
  if (rows.length === 0) {
    return '';
  }
  const header = Object.keys(rows[0]);
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    header.join(','),
    ...rows.map((row) => header.map((key) => escape(row[key])).join(','))
  ].join('\r\n') + '\r\n';
}

function iso(epochSec) {
  return epochSec ? new Date(epochSec * 1000).toISOString() : '';
}

async function main() {
  const args = parseArgs(process.argv);
  const { config, seeds, store } = bootScript();
  await store.initialize();
  const state = store.getLatest();

  const outDir = path.resolve(args.out || path.join(config.projectRoot, 'exports'));
  fs.mkdirSync(outDir, { recursive: true });

  const regionName = (id) => (seeds.regions.find((region) => region.id === id) || {}).name || id;

  const players = Object.values(state.users).map((user) => ({
    id: user.id,
    display_name: user.display_name,
    team: user.team,
    code: user.code,
    code_type: user.code_type,
    total_contribution: user.total_contribution,
    energy: user.energy,
    banned: user.banned,
    created_at: iso(user.created_at),
    ...Object.fromEntries(seeds.regions.map((region) => [`region_${region.name}`, user.region_contributions[region.id] || 0]))
  }));

  const ledgerEntries = contributions.readLedgerFile(config.dataDir, config.ledgerFileName);
  // 兜底：若 jsonl 缺失，用 state 内最近流水补足
  const contributionRows = (ledgerEntries.length > 0 ? ledgerEntries : state.contribution_log).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    user: (state.users[entry.user_id] || {}).display_name || '',
    team: entry.team || '',
    region: entry.region_id ? regionName(entry.region_id) : '',
    action: entry.action_id || entry.reason || '',
    user_delta: entry.user_delta,
    team_delta: entry.team_delta,
    anomaly_delta: entry.anomaly_delta,
    request_id: entry.request_id || '',
    created_at: iso(entry.created_at)
  }));

  const codeRows = Object.values(state.codes).map((codeEntry) => ({
    code: codeEntry.code,
    type: codeEntry.type,
    status: codeEntry.status,
    disabled: codeEntry.disabled ? 'yes' : 'no',
    bound_player: (state.users[codeEntry.bound_user_id] || {}).display_name || '',
    bound_at: iso(codeEntry.bound_at),
    batch_id: codeEntry.batch_id
  }));

  const lotteryRows = lottery.listDraws(state, seeds, { limit: 100000 }).map((draw) => ({
    id: draw.id,
    prize: draw.prize_name,
    winner: draw.winner_display_name,
    team: draw.winner_team,
    weight_snapshot: draw.weight_snapshot,
    total_weight: draw.total_weight_snapshot,
    status: draw.status,
    void_reason: draw.void_reason,
    drawn_at: iso(draw.drawn_at),
    claimed_at: iso(draw.claimed_at)
  }));

  const summary = {
    exported_at: new Date().toISOString(),
    activity: state.activity,
    teams: state.teams,
    regions: seeds.regions.map((region) => ({
      id: region.id,
      name: region.name,
      anomaly_remaining: state.regions[region.id].anomaly_remaining,
      max_anomaly: region.max_anomaly,
      cleared: state.regions[region.id].cleared,
      participants: state.regions[region.id].participant_ids.length
    })),
    player_count: players.length,
    ledger_entries: contributionRows.length,
    draws: lotteryRows.length
  };

  const outputs = [
    ['players.csv', toCsv(players)],
    ['contributions.csv', toCsv(contributionRows)],
    ['codes.csv', toCsv(codeRows)],
    ['lottery.csv', toCsv(lotteryRows)],
    ['summary.json', JSON.stringify(summary, null, 2)]
  ];
  for (const [name, content] of outputs) {
    fs.writeFileSync(path.join(outDir, name), `\uFEFF${content}`, 'utf8');
  }

  console.log(`导出完成 → ${outDir}`);
  for (const [name] of outputs) {
    console.log(`  ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
