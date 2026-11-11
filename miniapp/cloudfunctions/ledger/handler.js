'use strict';
// 云函数 ledger 的主体逻辑。和 wx-server-sdk 分开写，是为了能在 node 里用假数据库测试。
// 所有权限判断都在 lib/ledgerCore.js（和本机模式同一份）。
const crypto = require('crypto');
const core = require('./lib/ledgerCore');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genId() { return crypto.randomBytes(12).toString('hex'); }
function genCode() {
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}

const PAGE = 100;
async function fetchAll(db, coll, where) {
  let out = [];
  let skip = 0;
  for (;;) {
    const r = await db.collection(coll).where(where).skip(skip).limit(PAGE).get();
    out = out.concat(r.data);
    if (r.data.length < PAGE) break;
    skip += PAGE;
  }
  return out;
}

function strip(doc) {
  const o = Object.assign({}, doc);
  delete o._id;
  delete o._openid;
  return o;
}

async function loadState(db, ledgerId) {
  if (typeof ledgerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(ledgerId)) return null;
  let ledger = null;
  try {
    const r = await db.collection('ledgers').doc(ledgerId).get();
    ledger = r.data ? strip(r.data) : null;
  } catch (e) {
    return null; // 文档不存在
  }
  if (!ledger) return null;
  const [members, expenses, payments] = await Promise.all([
    fetchAll(db, 'members', { ledgerId }),
    fetchAll(db, 'expenses', { ledgerId }),
    fetchAll(db, 'payments', { ledgerId }),
  ]);
  return { ledger, members: members.map(strip), expenses: expenses.map(strip), payments: payments.map(strip) };
}

// 注意: 云数据库没有跨多个文档的事务，所以改动是一条一条写的。
// 每条改动只碰自己那一个文档(新增一笔账 = 新增一个文档)，不同的人同时记账不会互相覆盖。
async function applyToDb(db, mutations) {
  for (const m of mutations) {
    if (m.op === 'add') {
      await db.collection(m.coll).add({ data: Object.assign({ _id: m.doc.id }, m.doc) });
    } else if (m.op === 'update') {
      const patch = Object.assign({}, m.patch);
      // shares 是对象，云数据库 update 默认只改里面指定的字段；要整个替换，否则改参与人后会残留旧的人
      if (patch.shares && db.command && db.command.set) patch.shares = db.command.set(patch.shares);
      await db.collection(m.coll).doc(m.id).update({ data: patch });
    } else if (m.op === 'remove') {
      await db.collection(m.coll).doc(m.id).remove();
    } else if (m.op === 'removeLedger') {
      for (const coll of ['members', 'expenses', 'payments']) {
        await db.collection(coll).where({ ledgerId: m.ledgerId }).remove();
      }
      await db.collection('ledgers').doc(m.ledgerId).remove();
    }
  }
}

async function handle(db, event, openid, deps) {
  const d = deps || {};
  const ctx = { uid: openid, now: (d.now || Date.now)(), genId: d.genId || genId, genCode: d.genCode || genCode };
  if (!openid) return { ok: false, code: 'NO_LOGIN', message: '没有拿到登录信息，请重新打开小程序' };
  const action = event && event.action;
  const params = (event && event.params) || {};
  try {
    if (action === 'listLedgers') {
      const mine = (await fetchAll(db, 'members', { uid: openid })).filter((m) => !m.leftAt);
      const idsList = [];
      mine.forEach((m) => { if (idsList.indexOf(m.ledgerId) < 0) idsList.push(m.ledgerId); });
      const out = [];
      for (const id of idsList.slice(0, 50)) {
        const st = await loadState(db, id);
        if (st) out.push(core.summarizeLedger(st, openid));
      }
      out.sort((a, b) => b.createdAt - a.createdAt);
      return { ok: true, result: { ledgers: out } };
    }

    if (action === 'deleteMyData') {
      const mine = await fetchAll(db, 'members', { uid: openid });
      const idsList = [];
      mine.forEach((m) => { if (idsList.indexOf(m.ledgerId) < 0) idsList.push(m.ledgerId); });
      for (const id of idsList) {
        const st = await loadState(db, id);
        if (st) await applyToDb(db, core.planAccountDeletion(st, openid, ctx.now));
      }
      return { ok: true, result: {} };
    }

    let state = null;
    if (action === 'createLedger') {
      if (params.clientId) {
        const found = await fetchAll(db, 'ledgers', { ownerUid: openid, clientId: String(params.clientId).slice(0, 64) });
        if (found.length) return { ok: true, result: { ledgerId: found[0].id, duplicate: true } };
      }
    } else {
      state = await loadState(db, params.ledgerId);
    }
    const out = core.run(action, state, params, ctx);
    await applyToDb(db, out.mutations);
    return { ok: true, result: out.result };
  } catch (e) {
    if (e && e.name === 'LedgerError') return { ok: false, code: e.code, message: e.message };
    console.error('ledger function error', action, e && e.message);
    return { ok: false, code: 'SERVER', message: '服务器开小差了，请稍后再试' };
  }
}

module.exports = { handle, loadState, applyToDb, fetchAll };
