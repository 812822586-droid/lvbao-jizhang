'use strict';
// 「本机体验模式」: 没有云环境时，共同账本存在这台手机的本地存储里。
// 规则和云端完全一样（同一份 ledgerCore），区别只有: 只有你自己这一个真人用户，
// 其他人只能作为「虚拟成员」记在账上，不能真的加入。
const core = require('../lib/ledgerCore');
const ids = require('./ids');

const KEY = 'lvbao.local.ledgers.v1';
const LOCAL_UID = 'local-user';

function apiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function createLocalBackend(storage, deps) {
  const d = deps || {};
  const nowFn = d.now || Date.now;
  const genId = d.genId || ids.genId;
  const genCode = d.genCode || ids.genCode;
  const uid = d.uid || LOCAL_UID;

  function load() {
    const raw = storage.get(KEY);
    if (raw && typeof raw === 'object' && raw.ledgers && typeof raw.ledgers === 'object') return raw;
    return { ledgers: {} };
  }
  function save(data) {
    if (!storage.set(KEY, data)) throw apiError('STORAGE_FULL', '手机存储空间不足，保存失败');
  }

  function callSync(action, params) {
    const p = params || {};
    const data = load();
    const ctx = { uid, now: nowFn(), genId, genCode };

    if (action === 'listLedgers') {
      const list = Object.keys(data.ledgers).map((id) => core.summarizeLedger(data.ledgers[id], uid))
        .sort((a, b) => b.createdAt - a.createdAt);
      return { ledgers: list };
    }
    if (action === 'previewInvite' || action === 'joinLedger') {
      throw apiError('LOCAL_MODE', '现在是「本机体验模式」，还不能加入别人的账本。等开通云开发后才能多人一起记。');
    }
    if (action === 'deleteMyData') {
      storage.remove(KEY);
      return {};
    }
    if (action === 'createLedger') {
      if (p.clientId) {
        const hit = Object.keys(data.ledgers).find((id) => data.ledgers[id].ledger.clientId === String(p.clientId).slice(0, 64));
        if (hit) return { ledgerId: hit, duplicate: true };
      }
      const out = core.run(action, null, p, ctx);
      const next = core.applyMutations(null, out.mutations);
      data.ledgers[next.ledger.id] = next;
      save(data);
      return out.result;
    }
    const state = data.ledgers[p.ledgerId];
    const out = core.run(action, state, p, ctx);
    if (out.mutations.length) {
      const next = core.applyMutations(state, out.mutations);
      if (next.ledger) data.ledgers[p.ledgerId] = next; else delete data.ledgers[p.ledgerId];
      save(data);
    }
    return out.result;
  }

  return {
    mode: 'local',
    call(action, params) {
      return new Promise((resolve, reject) => {
        try { resolve(callSync(action, params)); } catch (e) { reject(e); }
      });
    },
  };
}

module.exports = { createLocalBackend, apiError, KEY, LOCAL_UID };
