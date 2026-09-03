'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { normalizeForMatch, compileWordList, findSensitiveWord } = require('../../shared/sensitive-words');
const { loadSeeds } = require('../../server/seed-loader');
const path = require('node:path');

const SEEDS_DIR = path.resolve(__dirname, '../../shared/seeds');

test('normalize strips separators and full-width characters', () => {
  assert.equal(normalizeForMatch('色 情'), '色情');
  assert.equal(normalizeForMatch('傻。逼'), '傻逼');
  assert.equal(normalizeForMatch('ＳＢ'), 'sb');
  assert.equal(normalizeForMatch('AbC'), 'abc');
});

test('findSensitiveWord hits every category', () => {
  const list = compileWordList({
    categories: {
      political: ['台独'],
      porn: ['色情'],
      abuse: ['傻逼'],
      ad: ['加微信', 'https://', '.com']
    }
  });
  assert.equal(findSensitiveWord('支持的独派', list), null, '不相关文本不误伤');
  assert.equal(findSensitiveWord('我要台独', list).category, 'political');
  assert.equal(findSensitiveWord('色 情 内 容', list).category, 'porn');
  assert.equal(findSensitiveWord('真是个傻逼', list).category, 'abuse');
  assert.equal(findSensitiveWord('加微信领奖', list).category, 'ad');
  assert.equal(findSensitiveWord('来 https://spam.example 领奖', list).category, 'ad', 'URL 类词条按原文匹配');
  assert.equal(findSensitiveWord('comeback勇者', list), null, '普通昵称不被域名词条误伤');
  assert.equal(findSensitiveWord('灵梦最强', list), null);
  assert.equal(findSensitiveWord('', list), null);
});

test('bundled sensitive words load with the seeds', () => {
  const seeds = loadSeeds(SEEDS_DIR);
  assert.ok(Array.isArray(seeds.sensitiveWords));
  assert.ok(seeds.sensitiveWords.length > 50);
  const hit = findSensitiveWord('涉政测试：习近平', seeds.sensitiveWords);
  assert.equal(hit.category, 'political');
});
