'use strict';
// 云函数 personal: 个人账本的「云备份」。用户主动点按钮才会调用。
const records = require('./lib/records');

const COLL = 'personal_backups';

async function handle(db, event, openid, deps) {
  const now = ((deps && deps.now) || Date.now)();
  if (!openid) return { ok: false, code: 'NO_LOGIN', message: '没有拿到登录信息，请重新打开小程序' };
  const action = event && event.action;
  const params = (event && event.params) || {};
  try {
    if (action === 'pushBackup') {
      const list = Array.isArray(params.records) ? params.records : null;
      if (!list) return { ok: false, code: 'BAD_REQUEST', message: '备份内容不对' };
      if (list.length > records.MAX_RECORDS) return { ok: false, code: 'TOO_MANY', message: '账目太多，最多备份 ' + records.MAX_RECORDS + ' 笔' };
      const clean = [];
      const seen = {};
      list.forEach((it) => {
        const r = records.normalizeRecord(it);
        if (r && !seen[r.id]) { seen[r.id] = true; clean.push(r); }
      });
      // 用 set 覆盖: 云上永远只有「最近一次备份」这一份
      await db.collection(COLL).doc(openid).set({ data: { records: clean, updatedAt: now } });
      return { ok: true, result: { count: clean.length, updatedAt: now } };
    }
    if (action === 'pullBackup') {
      let doc = null;
      try { doc = (await db.collection(COLL).doc(openid).get()).data; } catch (e) { doc = null; }
      return { ok: true, result: { records: doc ? doc.records || [] : [], updatedAt: doc ? doc.updatedAt : null } };
    }
    if (action === 'deleteBackup') {
      try { await db.collection(COLL).doc(openid).remove(); } catch (e) { /* 本来就没有 */ }
      return { ok: true, result: {} };
    }
    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的操作' };
  } catch (e) {
    console.error('personal function error', action, e && e.message);
    return { ok: false, code: 'SERVER', message: '服务器开小差了，请稍后再试' };
  }
}

module.exports = { handle, COLL };
