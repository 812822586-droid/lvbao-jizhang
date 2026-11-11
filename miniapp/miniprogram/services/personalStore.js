'use strict';
// 个人记账本的本地存储。数据只在这台手机，除非你主动点「备份到云端」。
const records = require('../lib/records');
const ids = require('./ids');
const { createWxStorage } = require('./storage');

const KEY = 'lvbao.records.v1';

function create(storage, deps) {
  const d = deps || {};
  const nowFn = d.now || Date.now;
  const genId = d.genId || ids.genId;

  // 读出来；如果发现存的东西坏了，先把原文备份一份再重新开始，绝不悄悄清空。
  function load() {
    const raw = storage.get(KEY);
    if (raw === null || raw === undefined) return { records: [], notice: '' };
    let list = raw && typeof raw === 'object' ? raw.records : null;
    if (!Array.isArray(list)) {
      storage.set(KEY + '.broken.' + nowFn(), raw);
      storage.remove(KEY);
      return { records: [], notice: '本机的账本数据损坏了，已把原文件另存备份，现在是一本新账本。' };
    }
    const seen = {};
    const out = [];
    list.forEach((it) => {
      const r = records.normalizeRecord(it, { genId, now: nowFn() });
      if (r && !seen[r.id]) { seen[r.id] = true; out.push(r); }
    });
    return { records: out, notice: '' };
  }

  function persist(list) {
    if (!storage.set(KEY, { version: 1, records: list })) throw new Error('手机存储空间不足，保存失败');
  }

  function add(input) {
    const cur = load().records;
    if (cur.length >= records.MAX_RECORDS) throw new Error('账目已达上限（' + records.MAX_RECORDS + ' 笔），请先导出或删除旧账');
    const r = records.normalizeRecord(Object.assign({}, input, { id: undefined, createdAt: undefined }), { genId, now: nowFn() });
    if (!r) throw new Error('这笔账填得不对，请检查金额和日期');
    cur.push(r);
    persist(cur);
    return r;
  }

  function update(id, input) {
    const cur = load().records;
    const i = cur.findIndex((r) => r.id === id);
    if (i < 0) throw new Error('找不到这笔账');
    const r = records.normalizeRecord(Object.assign({}, input, { id, createdAt: cur[i].createdAt, updatedAt: nowFn() }), { genId, now: nowFn() });
    if (!r) throw new Error('这笔账填得不对，请检查金额和日期');
    cur[i] = r;
    persist(cur);
    return r;
  }

  function remove(id) {
    const cur = load().records;
    const next = cur.filter((r) => r.id !== id);
    persist(next);
    return cur.length - next.length;
  }

  function get(id) { return load().records.find((r) => r.id === id) || null; }

  function mergeIn(incoming) {
    const res = records.mergeRecords(load().records, incoming);
    persist(res.records);
    return res;
  }

  function clearAll() { storage.remove(KEY); }

  return { load, add, update, remove, get, mergeIn, clearAll, KEY };
}

const inst = typeof wx !== 'undefined' ? create(createWxStorage(wx)) : {};
inst.create = create;
module.exports = inst;
