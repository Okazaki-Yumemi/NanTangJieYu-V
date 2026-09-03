'use strict';

/**
 * 昵称敏感词过滤。
 *
 * 匹配前先做文本规范化：全角转半角、转小写、去除空白与常见分隔符，
 * 防止「色 情」「s b」这类简单绕过。命中返回词条与类别，未命中返回 null。
 * 词库在 shared/seeds/sensitive-words.json，可随时增删词条。
 */

function normalizeForMatch(text) {
  let normalized = String(text || '').toLowerCase();
  // 全角 ASCII 与常见全角标点 -> 半角
  normalized = normalized.replace(/[\uFF01-\uFF5E]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xFEE0)
  );
  normalized = normalized.replace(/\u3000/g, '');
  // 去掉空白与分隔符，防止用符号拆词绕过
  normalized = normalized.replace(/[\s\-_.·•*~@#$/\\|(),，。、！!？?：:；;'"「」【】\[\]（）()]+/g, '');
  return normalized;
}

function compileWordList(rawConfig) {
  const list = [];
  for (const [category, words] of Object.entries((rawConfig && rawConfig.categories) || {})) {
    for (const word of words || []) {
      if (typeof word === 'string' && word.trim()) {
        const raw = word.trim().toLowerCase();
        list.push({
          category,
          raw,
          word: normalizeForMatch(raw),
          // URL / 域名类词条用原文匹配，避免去掉分隔符后误伤普通昵称
          urlLike: /https?:\/\/|www\.|\.(com|cn|net|top|xyz|vip)/.test(raw)
        });
      }
    }
  }
  list.sort((a, b) => b.word.length - a.word.length);
  return list;
}

function findSensitiveWord(text, compiledList) {
  if (!Array.isArray(compiledList)) {
    return null;
  }
  const normalized = normalizeForMatch(text);
  const rawLower = String(text || '').toLowerCase();
  for (const entry of compiledList) {
    if (entry.urlLike) {
      if (rawLower.includes(entry.raw)) {
        return { category: entry.category, word: entry.raw };
      }
      continue;
    }
    if (normalized && normalized.includes(entry.word)) {
      return { category: entry.category, word: entry.word };
    }
  }
  return null;
}

module.exports = {
  normalizeForMatch,
  compileWordList,
  findSensitiveWord
};
