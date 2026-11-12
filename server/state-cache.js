'use strict';

// 仅缓存已提交的只读快照；事务草稿和领域测试里的可变状态不能缓存。
// WeakMap 让旧快照及其排行榜随事务提交自然回收。
const snapshots = new WeakMap();
function publish(state) { snapshots.set(state, new Map()); return state; }
function memo(state, key, build) {
  const cache = snapshots.get(state);
  if (!cache) return build();
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}
module.exports = { publish, memo };
