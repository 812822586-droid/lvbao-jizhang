// 测试用: 模拟「多个人」操作同一个账本
const core = require('../miniprogram/lib/ledgerCore');

function makeWorld() {
  let t = 1000;
  let n = 0;
  const w = {
    state: null,
    genId: () => 'id' + (++n),
    genCode: () => 'CODE' + (++n),
    tick() { t += 1000; return t; },
    // 以 uid 的身份执行一个操作；成功就把改动写进 state
    act(uid, action, params) {
      const ctx = { uid, now: w.tick(), genId: w.genId, genCode: w.genCode };
      const out = core.run(action, w.state, params, ctx);
      if (out.mutations.length) w.state = core.applyMutations(w.state, out.mutations);
      return out.result;
    },
    fails(uid, action, params, code) {
      let err = null;
      try { w.act(uid, action, params); } catch (e) { err = e; }
      if (!err) throw new Error('expected failure ' + code + ' for ' + action);
      if (err.name !== 'LedgerError') throw err;
      if (code && err.code !== code) throw new Error('expected ' + code + ' but got ' + err.code + ' ' + err.message);
      return err;
    },
  };
  return w;
}

module.exports = { makeWorld };
