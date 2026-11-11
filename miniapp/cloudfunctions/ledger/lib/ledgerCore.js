'use strict';
// 共同账本的全部规则（谁能做什么、怎么校验、怎么算）都写在这一个文件里。
// 本机体验模式(localBackend)和云函数(cloudfunctions/ledger)用的是同一份代码，
// 所以在 node 里测好了，两边行为就一致。
//
// 用法: run(action, state, params, ctx) -> { mutations, result }
//   state = { ledger, members[], expenses[], payments[] }（创建账本时为 null）
//   ctx   = { uid, now, genId(), genCode() }   uid 是当前用户的唯一编号(云端是 OPENID)
//   mutations 是「要写入存储的改动清单」，由调用方真正写入(本机存储或云数据库)。
const money = require('./money');
const settle = require('./settle');

const LIMITS = { MEMBERS: 30, EXPENSES: 2000, LEDGER_NAME: 30, MEMBER_NAME: 20, TITLE: 30, NOTE: 100 };

class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
function fail(code, message) { throw new LedgerError(code, message); }

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---------- 改动清单应用到内存状态（本机模式和测试使用） ----------
function emptyState() { return { ledger: null, members: [], expenses: [], payments: [] }; }

function applyMutations(state, mutations) {
  const next = state ? clone(state) : emptyState();
  mutations.forEach((m) => {
    if (m.op === 'removeLedger') {
      next.ledger = null; next.members = []; next.expenses = []; next.payments = [];
      return;
    }
    if (m.coll === 'ledgers') {
      if (m.op === 'add') next.ledger = clone(m.doc);
      else if (m.op === 'update') Object.assign(next.ledger, clone(m.patch));
      return;
    }
    const arr = next[m.coll];
    if (m.op === 'add') arr.push(clone(m.doc));
    else if (m.op === 'update') {
      const t = arr.find((x) => x.id === m.id);
      if (t) Object.assign(t, clone(m.patch));
    } else if (m.op === 'remove') {
      const i = arr.findIndex((x) => x.id === m.id);
      if (i >= 0) arr.splice(i, 1);
    }
  });
  return next;
}

const add = (coll, doc) => ({ op: 'add', coll, id: doc.id, doc });
const update = (coll, id, patch) => ({ op: 'update', coll, id, patch });
const remove = (coll, id) => ({ op: 'remove', coll, id });

// ---------- 查询小工具 ----------
function sortedMembers(state) {
  return state.members.slice().sort((a, b) => (a.joinedAt - b.joinedAt) || (a.id < b.id ? -1 : 1));
}
function activeMembers(state) { return sortedMembers(state).filter((m) => !m.leftAt); }
function memberOf(state, uid) {
  if (!uid) return null;
  return state.members.find((m) => m.uid === uid && !m.leftAt) || null;
}
function requireMember(state, ctx) {
  const me = memberOf(state, ctx.uid);
  if (!me) fail('NOT_MEMBER', '你不是这个账本的成员');
  return me;
}
function requireOwner(state, ctx) {
  const me = requireMember(state, ctx);
  if (me.role !== 'owner') fail('NOT_OWNER', '只有创建账本的人可以这样做');
  return me;
}
function memberById(state, id) { return state.members.find((m) => m.id === id) || null; }

// 这个操作人能不能代表某个成员行事: 就是他本人；或者他是账本创建者而对方是「虚拟成员」(没有人认领)
function canActFor(me, target) {
  if (!target) return false;
  if (target.uid && target.uid === me.uid) return true;
  return me.role === 'owner' && !target.uid;
}

function balancesOf(state) {
  return settle.computeBalances(state.members.map((m) => m.id), state.expenses, state.payments);
}

// ---------- 给界面用的完整视图（不含任何人的 uid） ----------
function computeView(state, uid) {
  const members = sortedMembers(state);
  const me = memberOf(state, uid);
  const balances = balancesOf(state);
  const order = members.map((m) => m.id);
  const rawTransfers = settle.minimalTransfers(balances, order);
  const pending = state.payments.filter((p) => p.status === 'paid');
  const transfers = rawTransfers.map((t) => {
    const hit = pending.find((p) => p.fromId === t.fromId && p.toId === t.toId);
    return { fromId: t.fromId, toId: t.toId, amountCents: t.amountCents, pendingPaymentId: hit ? hit.id : null };
  });
  const live = state.expenses.filter((e) => !e.deletedAt);
  const totalSpentCents = live.reduce((a, e) => a + e.amountCents, 0);
  const settled = live.length > 0 && rawTransfers.length === 0;

  let lastConfirmedAt = 0;
  state.payments.forEach((p) => { if (p.status === 'confirmed' && p.confirmedAt > lastConfirmedAt) lastConfirmedAt = p.confirmedAt; });
  let lastChange = 0;
  state.expenses.forEach((e) => { lastChange = Math.max(lastChange, e.updatedAt || 0, e.deletedAt || 0); });
  const changedAfterSettle = lastConfirmedAt > 0 && lastChange > lastConfirmedAt && !settled;

  const breakdowns = {};
  members.forEach((m) => { breakdowns[m.id] = settle.explainMember(m.id, state.expenses, state.payments); });

  const expenses = state.expenses.slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt - a.createdAt)))
    .map((e) => ({
      id: e.id, title: e.title, amountCents: e.amountCents, payerId: e.payerId, splitMode: e.splitMode,
      participantIds: e.participantIds.slice(), shares: Object.assign({}, e.shares), date: e.date, note: e.note || '',
      createdAt: e.createdAt, updatedAt: e.updatedAt, rev: e.rev, deletedAt: e.deletedAt || null,
      canEdit: !!me && (e.createdBy === uid || me.role === 'owner'),
    }));
  const payments = state.payments.slice().sort((a, b) => b.createdAt - a.createdAt).map((p) => {
    const from = memberById(state, p.fromId);
    const to = memberById(state, p.toId);
    return {
      id: p.id, fromId: p.fromId, toId: p.toId, amountCents: p.amountCents, status: p.status,
      createdAt: p.createdAt, paidAt: p.paidAt || null, confirmedAt: p.confirmedAt || null,
      canConfirm: !!me && p.status === 'paid' && canActFor(me, to),
      canCancel: !!me && ((p.status === 'paid' && (canActFor(me, from) || canActFor(me, to))) || (p.status === 'confirmed' && canActFor(me, to))),
    };
  });
  const transfersOut = transfers.map((t) => {
    const from = memberById(state, t.fromId);
    return Object.assign({}, t, { canMarkPaid: !!me && !t.pendingPaymentId && canActFor(me, from) });
  });

  return {
    ledger: {
      id: state.ledger.id, name: state.ledger.name, inviteCode: state.ledger.inviteCode,
      inviteActive: !!state.ledger.inviteActive, createdAt: state.ledger.createdAt,
      memberCount: members.filter((m) => !m.leftAt).length,
    },
    me: me ? { memberId: me.id, isOwner: me.role === 'owner' } : null,
    members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, virtual: !m.uid && !m.leftAt, claimed: !!m.uid, left: !!m.leftAt, isMe: !!me && m.id === me.id })),
    expenses, payments, balances, transfers: transfersOut, totalSpentCents, settled, changedAfterSettle, breakdowns,
  };
}

function summarizeLedger(state, uid) {
  const me = memberOf(state, uid);
  const live = state.expenses.filter((e) => !e.deletedAt);
  return {
    id: state.ledger.id, name: state.ledger.name, createdAt: state.ledger.createdAt,
    memberCount: state.members.filter((m) => !m.leftAt).length,
    isOwner: !!me && me.role === 'owner',
    totalSpentCents: live.reduce((a, e) => a + e.amountCents, 0),
    settled: live.length > 0 && settle.minimalTransfers(balancesOf(state), state.members.map((m) => m.id)).length === 0,
  };
}

// ---------- 账目校验 ----------
function parseExpense(state, p, oldExpense) {
  const title = cleanText(p.title, LIMITS.TITLE);
  if (!title) fail('BAD_TITLE', '请写清这笔钱花在什么上');
  const amount = p.amountCents;
  if (!Number.isInteger(amount) || amount <= 0 || amount > money.MAX_CENTS) fail('BAD_AMOUNT', '金额不对');
  if (!isValidDate(p.date)) fail('BAD_DATE', '日期不对');

  const allowed = {};
  activeMembers(state).forEach((m) => { allowed[m.id] = true; });
  if (oldExpense) {
    allowed[oldExpense.payerId] = true;
    oldExpense.participantIds.forEach((id) => { allowed[id] = true; });
  }
  if (!allowed[p.payerId]) fail('BAD_PAYER', '付钱的人不在账本里');
  const pids = [];
  (Array.isArray(p.participantIds) ? p.participantIds : []).forEach((id) => { if (pids.indexOf(id) < 0) pids.push(id); });
  if (!pids.length) fail('NO_PARTICIPANT', '请至少选一个参与分摊的人');
  pids.forEach((id) => { if (!allowed[id]) fail('BAD_PARTICIPANT', '有参与的人不在账本里'); });
  const order = sortedMembers(state).map((m) => m.id);
  const ordered = pids.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));

  const splitMode = p.splitMode === 'custom' ? 'custom' : 'equal';
  const shares = {};
  if (splitMode === 'equal') {
    const parts = money.splitEqual(amount, ordered.length);
    ordered.forEach((id, i) => { shares[id] = parts[i]; });
  } else {
    const cs = p.customShares || {};
    const keys = Object.keys(cs);
    if (keys.length !== ordered.length || ordered.some((id) => cs[id] === undefined)) fail('SHARES_MISMATCH', '指定金额要和参与的人一一对应');
    let total = 0;
    ordered.forEach((id) => {
      const v = cs[id];
      if (!Number.isInteger(v) || v <= 0 || v > money.MAX_CENTS) fail('BAD_SHARE', '每个人的金额都要大于 0');
      shares[id] = v;
      total += v;
    });
    if (total !== amount) {
      const diff = amount - total;
      fail('SHARES_MISMATCH', '每人金额加起来是 ' + money.formatCents(total) + ' 元，和总额 ' + money.formatCents(amount) + ' 元' + (diff > 0 ? '少了 ' : '多了 ') + money.formatCents(Math.abs(diff)) + ' 元');
    }
  }
  return { title, amountCents: amount, payerId: p.payerId, splitMode, participantIds: ordered, shares, date: p.date, note: cleanText(p.note, LIMITS.NOTE) };
}

function newMember(ctx, ledgerId, fields) {
  return Object.assign({ id: ctx.genId(), ledgerId, uid: null, role: 'member', joinedAt: ctx.now, leftAt: null }, fields);
}

function requireName(v, max, what) {
  const s = cleanText(v, max);
  if (!s) fail('BAD_NAME', '请填写' + what);
  return s;
}

function checkInvite(state, p) {
  if (!state.ledger.inviteActive || !p.code || String(p.code) !== String(state.ledger.inviteCode)) {
    fail('INVITE_INVALID', '这个邀请已经失效，请让对方重新发一次邀请');
  }
}

// ---------- 各个操作 ----------
const handlers = {
  createLedger(state, p, ctx) {
    const name = requireName(p.name, LIMITS.LEDGER_NAME, '账本名字');
    const myName = requireName(p.myName, LIMITS.MEMBER_NAME, '你的昵称');
    const ledger = { id: ctx.genId(), name, ownerUid: ctx.uid, clientId: p.clientId ? String(p.clientId).slice(0, 64) : '', inviteCode: ctx.genCode(), inviteActive: true, createdAt: ctx.now, updatedAt: ctx.now };
    const owner = newMember(ctx, ledger.id, { uid: ctx.uid, role: 'owner', name: myName });
    return { mutations: [add('ledgers', ledger), add('members', owner)], result: { ledgerId: ledger.id } };
  },

  getLedger(state, p, ctx) {
    requireMember(state, ctx);
    return { mutations: [], result: {} };
  },

  // 受邀的人点开卡片后先看一眼，确认再加入。不泄露金额和别人的 uid。
  previewInvite(state, p, ctx) {
    checkInvite(state, p);
    const owner = state.members.find((m) => m.role === 'owner');
    const free = activeMembers(state).filter((m) => !m.uid).map((m) => ({ id: m.id, name: m.name }));
    return {
      mutations: [],
      result: { preview: { ledgerName: state.ledger.name, ownerName: owner ? owner.name : '', memberCount: activeMembers(state).length, alreadyMember: !!memberOf(state, ctx.uid), claimable: free } },
    };
  },

  joinLedger(state, p, ctx) {
    checkInvite(state, p);
    if (memberOf(state, ctx.uid)) return { mutations: [], result: { ledgerId: state.ledger.id, already: true } };
    const myName = requireName(p.myName, LIMITS.MEMBER_NAME, '你的昵称');
    if (activeMembers(state).length >= LIMITS.MEMBERS && !p.claimMemberId) fail('TOO_MANY_MEMBERS', '这个账本人数已满（最多 ' + LIMITS.MEMBERS + ' 人）');
    if (p.claimMemberId) {
      const target = memberById(state, p.claimMemberId);
      if (!target || target.leftAt || target.uid) fail('CLAIM_INVALID', '这个名字已经被别人认领了');
      return { mutations: [update('members', target.id, { uid: ctx.uid, name: myName })], result: { ledgerId: state.ledger.id, memberId: target.id } };
    }
    if (activeMembers(state).some((m) => m.name === myName)) fail('NAME_DUP', '账本里已经有叫「' + myName + '」的人，请换一个昵称，或认领已有的名字');
    const m = newMember(ctx, state.ledger.id, { uid: ctx.uid, name: myName });
    return { mutations: [add('members', m)], result: { ledgerId: state.ledger.id, memberId: m.id } };
  },

  addVirtualMember(state, p, ctx) {
    requireMember(state, ctx);
    const name = requireName(p.name, LIMITS.MEMBER_NAME, '成员名字');
    if (activeMembers(state).length >= LIMITS.MEMBERS) fail('TOO_MANY_MEMBERS', '这个账本人数已满（最多 ' + LIMITS.MEMBERS + ' 人）');
    if (activeMembers(state).some((m) => m.name === name)) fail('NAME_DUP', '已经有叫「' + name + '」的人了');
    const m = newMember(ctx, state.ledger.id, { name });
    return { mutations: [add('members', m)], result: { memberId: m.id } };
  },

  // 退出账本(自己)或移出成员(创建者)。必须先对清账，已有的记录会保留。
  removeMember(state, p, ctx) {
    const me = requireMember(state, ctx);
    const target = memberById(state, p.memberId);
    if (!target || target.leftAt) fail('NOT_FOUND', '找不到这个成员');
    if (target.role === 'owner') fail('OWNER_CANNOT_LEAVE', '创建者不能退出，可以删除整个账本');
    if (!(target.uid === ctx.uid || me.role === 'owner')) fail('NOT_ALLOWED', '你不能移出这位成员');
    if (balancesOf(state)[target.id] !== 0) fail('BALANCE_NOT_ZERO', '「' + target.name + '」还有没结清的钱，请先对清账再退出');
    if (state.payments.some((x) => x.status === 'paid' && (x.fromId === target.id || x.toId === target.id))) fail('PENDING_PAYMENT', '还有等待确认的转账，请先处理');
    const used = state.expenses.some((e) => e.payerId === target.id || e.participantIds.indexOf(target.id) >= 0);
    if (!target.uid && !used) return { mutations: [remove('members', target.id)], result: {} };
    return { mutations: [update('members', target.id, { uid: null, leftAt: ctx.now })], result: {} };
  },

  rotateInvite(state, p, ctx) {
    requireOwner(state, ctx);
    return { mutations: [update('ledgers', state.ledger.id, { inviteCode: ctx.genCode(), inviteActive: true, updatedAt: ctx.now })], result: {} };
  },

  revokeInvite(state, p, ctx) {
    requireOwner(state, ctx);
    return { mutations: [update('ledgers', state.ledger.id, { inviteActive: false, updatedAt: ctx.now })], result: {} };
  },

  addExpense(state, p, ctx) {
    requireMember(state, ctx);
    if (p.clientId) {
      const dup = state.expenses.find((e) => e.clientId === p.clientId);
      if (dup) return { mutations: [], result: { expenseId: dup.id, duplicate: true } };
    }
    if (state.expenses.length >= LIMITS.EXPENSES) fail('TOO_MANY_EXPENSES', '这个账本的账目已达上限（' + LIMITS.EXPENSES + ' 笔）');
    const f = parseExpense(state, p, null);
    const e = Object.assign({ id: ctx.genId(), ledgerId: state.ledger.id, clientId: p.clientId ? String(p.clientId).slice(0, 64) : '', createdBy: ctx.uid, createdAt: ctx.now, updatedAt: ctx.now, rev: 1, deletedAt: null }, f);
    return { mutations: [add('expenses', e)], result: { expenseId: e.id } };
  },

  updateExpense(state, p, ctx) {
    const me = requireMember(state, ctx);
    const old = state.expenses.find((e) => e.id === p.expenseId);
    if (!old) fail('NOT_FOUND', '找不到这笔账');
    if (old.deletedAt) fail('DELETED', '这笔账已经删除了，请先恢复');
    if (!(old.createdBy === ctx.uid || me.role === 'owner')) fail('NOT_ALLOWED', '只有记这笔账的人或创建者可以修改');
    if (p.rev !== old.rev) fail('CONFLICT', '这笔账刚被别人改过，请返回刷新后再改');
    const f = parseExpense(state, p, old);
    return { mutations: [update('expenses', old.id, Object.assign({}, f, { updatedAt: ctx.now, rev: old.rev + 1 }))], result: { expenseId: old.id } };
  },

  deleteExpense(state, p, ctx) {
    const me = requireMember(state, ctx);
    const old = state.expenses.find((e) => e.id === p.expenseId);
    if (!old) fail('NOT_FOUND', '找不到这笔账');
    if (!(old.createdBy === ctx.uid || me.role === 'owner')) fail('NOT_ALLOWED', '只有记这笔账的人或创建者可以删除');
    if (old.deletedAt) return { mutations: [], result: {} };
    return { mutations: [update('expenses', old.id, { deletedAt: ctx.now, updatedAt: ctx.now, rev: old.rev + 1 })], result: {} };
  },

  restoreExpense(state, p, ctx) {
    const me = requireMember(state, ctx);
    const old = state.expenses.find((e) => e.id === p.expenseId);
    if (!old) fail('NOT_FOUND', '找不到这笔账');
    if (!(old.createdBy === ctx.uid || me.role === 'owner')) fail('NOT_ALLOWED', '只有记这笔账的人或创建者可以恢复');
    if (!old.deletedAt) return { mutations: [], result: {} };
    return { mutations: [update('expenses', old.id, { deletedAt: null, updatedAt: ctx.now, rev: old.rev + 1 })], result: {} };
  },

  // 付款方点「我已转账」。绿宝不经手钱，只是记一笔。
  markPaid(state, p, ctx) {
    const me = requireMember(state, ctx);
    if (p.clientId) {
      const dup = state.payments.find((x) => x.clientId === p.clientId);
      if (dup) return { mutations: [], result: { paymentId: dup.id, duplicate: true } };
    }
    const from = memberById(state, p.fromId);
    const to = memberById(state, p.toId);
    if (!from || !to || from.id === to.id) fail('BAD_PAYMENT', '转账双方不对');
    if (!canActFor(me, from)) fail('NOT_ALLOWED', '只能由付款的人本人标记已转账（虚拟成员可由创建者代标）');
    const amount = p.amountCents;
    if (!Number.isInteger(amount) || amount <= 0) fail('BAD_AMOUNT', '金额不对');
    const bal = balancesOf(state);
    if (!(bal[from.id] < 0 && bal[to.id] > 0 && amount <= -bal[from.id] && amount <= bal[to.id])) fail('NOT_OWED', '按现在的账，这笔转账已经不需要了，请刷新看看');
    const pay = { id: ctx.genId(), ledgerId: state.ledger.id, clientId: p.clientId ? String(p.clientId).slice(0, 64) : '', fromId: from.id, toId: to.id, amountCents: amount, status: 'paid', createdBy: ctx.uid, createdAt: ctx.now, paidAt: ctx.now, confirmedAt: null, updatedAt: ctx.now };
    return { mutations: [add('payments', pay)], result: { paymentId: pay.id } };
  },

  // 收款方确认「钱收到了」，这笔才算结清
  confirmPayment(state, p, ctx) {
    const me = requireMember(state, ctx);
    const pay = state.payments.find((x) => x.id === p.paymentId);
    if (!pay) fail('NOT_FOUND', '找不到这笔转账');
    if (pay.status === 'confirmed') return { mutations: [], result: {} };
    if (pay.status !== 'paid') fail('BAD_STATUS', '这笔转账已经被撤回了');
    if (!canActFor(me, memberById(state, pay.toId))) fail('NOT_ALLOWED', '只有收款的人本人可以确认收到（虚拟成员可由创建者代确认）');
    const bal = balancesOf(state);
    if (!(bal[pay.fromId] <= -pay.amountCents && bal[pay.toId] >= pay.amountCents)) fail('STALE', '账目在转账后又变化了，请先撤回这笔转账，按最新的账重新标记');
    return { mutations: [update('payments', pay.id, { status: 'confirmed', confirmedAt: ctx.now, updatedAt: ctx.now })], result: {} };
  },

  // 付款方撤回 / 收款方驳回「已转账」；收款方也可以撤销已经确认的收款（点错时）
  cancelPayment(state, p, ctx) {
    const me = requireMember(state, ctx);
    const pay = state.payments.find((x) => x.id === p.paymentId);
    if (!pay) fail('NOT_FOUND', '找不到这笔转账');
    if (pay.status === 'cancelled') return { mutations: [], result: {} };
    const from = memberById(state, pay.fromId);
    const to = memberById(state, pay.toId);
    const ok = pay.status === 'paid' ? (canActFor(me, from) || canActFor(me, to)) : canActFor(me, to);
    if (!ok) fail('NOT_ALLOWED', '你不能撤销这笔转账');
    return { mutations: [update('payments', pay.id, { status: 'cancelled', updatedAt: ctx.now })], result: {} };
  },

  deleteLedger(state, p, ctx) {
    requireOwner(state, ctx);
    return { mutations: [{ op: 'removeLedger', ledgerId: state.ledger.id }], result: {} };
  },
};

// 写操作做完以后，把最新的视图一起返回，界面不用再多请求一次
const NO_VIEW = { createLedger: 1, previewInvite: 1, deleteLedger: 1 };

function run(action, state, params, ctx) {
  const h = handlers[action];
  if (!h) fail('UNKNOWN_ACTION', '不支持的操作: ' + action);
  if (action !== 'createLedger' && (!state || !state.ledger)) fail('NOT_FOUND', '账本不存在或已删除');
  const out = h(state, params || {}, ctx);
  if (!NO_VIEW[action]) {
    const next = applyMutations(state, out.mutations);
    if (next.ledger && memberOf(next, ctx.uid)) out.result.view = computeView(next, ctx.uid);
  }
  return out;
}

// 用户注销时: 把他在每个账本里的身份匿名化。创建者注销时，账本交给最早加入的另一位真人；没有别人就删除账本。
function planAccountDeletion(state, uid, now) {
  const me = state.members.find((m) => m.uid === uid);
  const muts = [];
  if (!me) return muts;
  const others = sortedMembers(state).filter((m) => m.uid && m.uid !== uid && !m.leftAt);
  if (me.role === 'owner') {
    if (!others.length) return [{ op: 'removeLedger', ledgerId: state.ledger.id }];
    muts.push(update('ledgers', state.ledger.id, { ownerUid: others[0].uid, updatedAt: now }));
    muts.push(update('members', others[0].id, { role: 'owner' }));
  }
  muts.push(update('members', me.id, { uid: null, name: '已注销用户', role: 'member', leftAt: now }));
  state.expenses.forEach((e) => { if (e.createdBy === uid) muts.push(update('expenses', e.id, { createdBy: null })); });
  state.payments.forEach((x) => { if (x.createdBy === uid) muts.push(update('payments', x.id, { createdBy: null })); });
  return muts;
}

module.exports = { LIMITS, LedgerError, run, applyMutations, emptyState, computeView, summarizeLedger, planAccountDeletion, memberOf, balancesOf };
