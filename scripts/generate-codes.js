'use strict';

/**
 * 批量生成注册码并导出 CSV。
 *
 * 用法：
 *   node scripts/generate-codes.js --count 300 --type ordinary --note "现场批次" --out codes.csv
 *   --type  ordinary | special（特典票，初始抽奖权重 2）
 *   --out   输出 CSV 路径（默认 exports/codes-<时间戳>.csv）
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseArgs, bootScript } = require('./lib');
const codes = require('../server/domain/codes');

async function main() {
  const args = parseArgs(process.argv);
  const count = Number(args.count || 100);
  const type = args.type === 'special' ? 'special' : 'ordinary';
  const note = String(args.note || '');

  const { config, seeds, store } = bootScript();
  await store.initialize();

  const result = await store.transact((state) => {
    const now = Math.floor(Date.now() / 1000);
    const generated = codes.generateCodes(state, { count, type, note }, now);
    if (generated.error) {
      return store.abort(generated);
    }
    return { created: generated.created, batch_id: generated.batch_id };
  });

  if (result.error) {
    console.error(`生成失败：${result.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = result.created.map((codeEntry) => ({
    code: codeEntry.code,
    type: codeEntry.type,
    batch_id: codeEntry.batch_id
  }));

  const outPath = path.resolve(args.out || path.join(config.projectRoot, 'exports', `codes-${Date.now()}.csv`));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const lines = ['code,type,batch_id', ...rows.map((row) => `${row.code},${row.type},${row.batch_id}`)];
  fs.writeFileSync(outPath, `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');

  console.log(`已生成 ${rows.length} 个${type === 'special' ? '特典' : '普通'}注册码（批次 ${result.batch_id}）`);
  console.log(`CSV 已写入：${outPath}`);
  console.log('示例二维码地址（请替换为现场公布域名）：');
  for (const row of rows.slice(0, 3)) {
    console.log(`  https://your-domain.example/?code=${row.code}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
