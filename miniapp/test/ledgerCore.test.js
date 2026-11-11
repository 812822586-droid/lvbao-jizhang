const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../miniprogram/lib/ledgerCore');
const { makeWorld } = require('../testlib/world');

// 创建账本时 state 为 null，所以单独处理第一步
function setup() {
  const w = makeWorld();
  const ctx = { uid: 'U1', now: w.tick(), genId: w.genId, genCode: w.genCode };
  const out = core.run('createLedger', null, { name: '周末游', myName: '小甲' }, ctx);
  w.state = core.applyMutations(null, out.mutations);
  const L = out.result.ledgerId;
  const code = w.state.ledger.inviteCode;
  w.act('U2', 'joinLedger', { code, myName: '小乙' });
  w.act('U1', 'addVirtualMember', { name: '小丙' });
  const byName = {};
  w.state.members.forEach((m) => { byName[m.name] = m.id; });
  return { w, L, code, A: byName['小甲'], B: byName['小乙'], C: byName['小丙'] };
}
const eq = (A, B, C) => ({ participantIds: [A, B, C] });

test('创建账本: 创建者是 owner，邀请码有效', () => {
  const { w } = setup();
  assert.equal(w.state.ledger.ownerUid, 'U1');
  assert.equal(w.state.members.find((m) => m.uid === 'U1').role, 'owner');
  assert.equal(w.state.members.length, 3);
});

test('创建账本: 名字和昵称不能为空', () => {
  const w = makeWorld();
  const ctx = { uid: 'U1', now: 1, genId: w.genId, genCode: w.genCode };
  assert.throws(() => core.run('createLedger', null, { name: ' ', myName: 'x' }, ctx), { code: 'BAD_NAME' });
  assert.throws(() => core.run('createLedger', null, { name: 'x', myName: '' }, ctx), { code: 'BAD_NAME' });
});

test('验收: 甲付 300 住宿，乙付 120 餐费，甲乙丙都参加 → 乙给甲 20，丙给甲 140', () => {
  const { w, A, B, C } = setup();
  w.act('U1', 'addExpense', { title: '住宿', amountCents: 30000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  const r = w.act('U2', 'addExpense', { title: '餐费', amountCents: 12000, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  const v = r.view;
  assert.deepEqual(v.balances, { [A]: 16000, [B]: -2000, [C]: -14000 });
  assert.deepEqual(v.transfers.map((t) => [t.fromId, t.toId, t.amountCents]), [[C, A, 14000], [B, A, 2000]]);
  assert.equal(v.totalSpentCents, 42000);
  assert.equal(v.settled, false);
});

test('100 元分给 3 人: 总额仍是 100 元，尾差给排在前面的人', () => {
  const { w, A, B, C } = setup();
  const r = w.act('U1', 'addExpense', { title: '宵夜', amountCents: 10000, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [C, B, A] });
  const e = r.view.expenses[0];
  assert.deepEqual([e.shares[A], e.shares[B], e.shares[C]], [3334, 3333, 3333]); // 顺序按加入先后，不按点选先后
  assert.equal(e.shares[A] + e.shares[B] + e.shares[C], 10000);
});

test('指定金额分摊: 合计必须等于总额，错了会说差多少', () => {
  const { w, A, B } = setup();
  const base = { title: '烧烤', amountCents: 10000, payerId: A, splitMode: 'custom', date: '2026-11-01', participantIds: [A, B] };
  const e = w.fails('U1', 'addExpense', { ...base, customShares: { [A]: 6000, [B]: 3000 } }, 'SHARES_MISMATCH');
  assert.match(e.message, /少了 10\.00/);
  w.fails('U1', 'addExpense', { ...base, customShares: { [A]: 6000 } }, 'SHARES_MISMATCH');
  w.fails('U1', 'addExpense', { ...base, customShares: { [A]: 10000, [B]: 0 } }, 'BAD_SHARE');
  const r = w.act('U1', 'addExpense', { ...base, customShares: { [A]: 6000, [B]: 4000 } });
  assert.equal(r.view.balances[A], 4000);
  assert.equal(r.view.balances[B], -4000);
});

test('不参加的人不分摊；付钱的人可以不参加', () => {
  const { w, A, B, C } = setup();
  const r = w.act('U1', 'addExpense', { title: '给乙丙买票', amountCents: 20000, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [B, C] });
  assert.deepEqual(r.view.balances, { [A]: 20000, [B]: -10000, [C]: -10000 });
});

test('连续点保存(同一个 clientId)不会重复记账', () => {
  const { w, A, B, C } = setup();
  const p = { clientId: 'dup-1', title: '午饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) };
  const r1 = w.act('U1', 'addExpense', p);
  const r2 = w.act('U1', 'addExpense', p);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.expenseId, r1.expenseId);
  assert.equal(w.state.expenses.length, 1);
});

test('账目校验: 金额、日期、标题、人员', () => {
  const { w, A, B, C } = setup();
  const ok = { title: '午饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) };
  w.fails('U1', 'addExpense', { ...ok, amountCents: 0 }, 'BAD_AMOUNT');
  w.fails('U1', 'addExpense', { ...ok, amountCents: 12.5 }, 'BAD_AMOUNT');
  w.fails('U1', 'addExpense', { ...ok, amountCents: '9000' }, 'BAD_AMOUNT');
  w.fails('U1', 'addExpense', { ...ok, date: '2026-02-30' }, 'BAD_DATE');
  w.fails('U1', 'addExpense', { ...ok, title: '  ' }, 'BAD_TITLE');
  w.fails('U1', 'addExpense', { ...ok, payerId: 'nobody' }, 'BAD_PAYER');
  w.fails('U1', 'addExpense', { ...ok, participantIds: [] }, 'NO_PARTICIPANT');
  w.fails('U1', 'addExpense', { ...ok, participantIds: [A, 'ghost'] }, 'BAD_PARTICIPANT');
});

test('权限: 非成员打不开账本、不能记账', () => {
  const { w, A, B, C } = setup();
  w.fails('STRANGER', 'getLedger', {}, 'NOT_MEMBER');
  w.fails('STRANGER', 'addExpense', { title: 'x', amountCents: 100, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) }, 'NOT_MEMBER');
  w.fails('STRANGER', 'addVirtualMember', { name: '假人' }, 'NOT_MEMBER');
  w.fails('STRANGER', 'markPaid', { fromId: A, toId: B, amountCents: 1 }, 'NOT_MEMBER');
});

test('邀请: 转发的卡片也要自己确认加入；停用/换新后旧邀请失效', () => {
  const { w, code, C } = setup();
  const pv = core.run('previewInvite', w.state, { code }, { uid: 'U3', now: 1 });
  assert.equal(pv.result.preview.ledgerName, '周末游');
  assert.deepEqual(pv.result.preview.claimable.map((x) => x.name), ['小丙']);
  assert.ok(!JSON.stringify(pv.result).includes('U1')); // 不泄露别人的 uid
  w.fails('U3', 'joinLedger', { code: 'WRONG', myName: '小丁' }, 'INVITE_INVALID');
  w.fails('U2', 'revokeInvite', {}, 'NOT_OWNER');
  w.act('U1', 'revokeInvite', {});
  w.fails('U3', 'joinLedger', { code, myName: '小丁' }, 'INVITE_INVALID');
  w.act('U1', 'rotateInvite', {});
  assert.notEqual(w.state.ledger.inviteCode, code);
  w.fails('U3', 'joinLedger', { code, myName: '小丁' }, 'INVITE_INVALID'); // 旧码仍无效
  const r = w.act('U3', 'joinLedger', { code: w.state.ledger.inviteCode, myName: '小丁', claimMemberId: C });
  assert.equal(r.memberId, C);
  assert.equal(w.state.members.find((m) => m.id === C).uid, 'U3');
  w.fails('U4', 'joinLedger', { code: w.state.ledger.inviteCode, myName: '小戊', claimMemberId: C }, 'CLAIM_INVALID');
});

test('加入: 重复加入是幂等的；重名要换名；人数上限', () => {
  const { w, code } = setup();
  const again = w.act('U2', 'joinLedger', { code, myName: '小乙' });
  assert.equal(again.already, true);
  assert.equal(w.state.members.length, 3);
  w.fails('U9', 'joinLedger', { code, myName: '小甲' }, 'NAME_DUP');
  w.fails('U9', 'joinLedger', { code, myName: ' ' }, 'BAD_NAME');
  for (let i = 0; i < core.LIMITS.MEMBERS - 3; i++) w.act('U1', 'addVirtualMember', { name: '人' + i });
  w.fails('U1', 'addVirtualMember', { name: '多一个' }, 'TOO_MANY_MEMBERS');
  w.fails('U10', 'joinLedger', { code, myName: '新人' }, 'TOO_MANY_MEMBERS');
});

test('改账: 只有记账人或创建者能改；版本冲突会拦住；删除后可以恢复', () => {
  const { w, A, B, C } = setup();
  const r = w.act('U2', 'addExpense', { title: '午饭', amountCents: 9000, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  const id = r.expenseId;
  w.act('U3x', 'joinLedger', { code: w.state.ledger.inviteCode, myName: '小丁' });
  const edit = (uid, rev, amount) => w.act(uid, 'updateExpense', { expenseId: id, rev, title: '午饭', amountCents: amount, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  w.fails('U3x', 'updateExpense', { expenseId: id, rev: 1, title: '午饭', amountCents: 100, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) }, 'NOT_ALLOWED');
  edit('U2', 1, 9900); // 记账人本人
  assert.equal(w.state.expenses[0].rev, 2);
  w.fails('U2', 'updateExpense', { expenseId: id, rev: 1, title: '午饭', amountCents: 5000, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) }, 'CONFLICT'); // 用的是旧版本
  edit('U1', 2, 12000); // 创建者
  assert.equal(w.state.expenses[0].amountCents, 12000);
  w.fails('U3x', 'deleteExpense', { expenseId: id }, 'NOT_ALLOWED');
  w.act('U2', 'deleteExpense', { expenseId: id });
  assert.ok(w.state.expenses[0].deletedAt);
  assert.equal(core.computeView(w.state, 'U1').totalSpentCents, 0);
  w.fails('U2', 'updateExpense', { expenseId: id, rev: 4, title: 'x', amountCents: 100, payerId: B, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) }, 'DELETED');
  w.act('U2', 'restoreExpense', { expenseId: id });
  assert.equal(core.computeView(w.state, 'U1').totalSpentCents, 12000);
});

test('改账时改了参与人，旧的份额不会残留', () => {
  const { w, A, B, C } = setup();
  const r = w.act('U1', 'addExpense', { title: '晚饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  w.act('U1', 'updateExpense', { expenseId: r.expenseId, rev: 1, title: '晚饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [A, B] });
  assert.deepEqual(Object.keys(w.state.expenses[0].shares).sort(), [A, B].sort());
});

function twoPeopleOwing() {
  const s = setup();
  const { w, A, B } = s;
  w.act('U1', 'addExpense', { title: '住宿', amountCents: 20000, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [A, B] });
  return s; // 乙欠甲 100 元
}

test('结清: 付款方标记 → 收款方确认 → 才算结清', () => {
  const { w, A, B } = twoPeopleOwing();
  const v0 = core.computeView(w.state, 'U2');
  assert.equal(v0.transfers[0].canMarkPaid, true); // 乙看到自己能标记
  assert.equal(core.computeView(w.state, 'U1').transfers[0].canMarkPaid, false); // 甲不能替乙标记
  w.fails('U1', 'markPaid', { fromId: B, toId: A, amountCents: 10000 }, 'NOT_ALLOWED');
  const m = w.act('U2', 'markPaid', { clientId: 'p1', fromId: B, toId: A, amountCents: 10000 });
  assert.equal(m.view.settled, false); // 还没确认，不算结清
  assert.equal(m.view.transfers[0].pendingPaymentId, m.paymentId);
  assert.equal(w.act('U2', 'markPaid', { clientId: 'p1', fromId: B, toId: A, amountCents: 10000 }).duplicate, true);
  w.fails('U2', 'confirmPayment', { paymentId: m.paymentId }, 'NOT_ALLOWED'); // 付款方不能自己确认
  const c = w.act('U1', 'confirmPayment', { paymentId: m.paymentId });
  assert.equal(c.view.settled, true);
  assert.deepEqual(c.view.transfers, []);
  assert.deepEqual(c.view.balances, { [A]: 0, [B]: 0, [w.state.members.find((x) => x.name === '小丙').id]: 0 });
});

test('结清: 不能多转、不能反向转；撤回/驳回/撤销确认', () => {
  const { w, A, B } = twoPeopleOwing();
  w.fails('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10001 }, 'NOT_OWED');
  w.fails('U1', 'markPaid', { fromId: A, toId: B, amountCents: 100 }, 'NOT_OWED');
  const m = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 4000 });
  w.act('U2', 'cancelPayment', { paymentId: m.paymentId }); // 付款方撤回
  assert.equal(w.state.payments[0].status, 'cancelled');
  w.fails('U1', 'confirmPayment', { paymentId: m.paymentId }, 'BAD_STATUS');
  const m2 = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10000 });
  w.act('U1', 'cancelPayment', { paymentId: m2.paymentId }); // 收款方驳回
  const m3 = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10000 });
  w.act('U1', 'confirmPayment', { paymentId: m3.paymentId });
  w.fails('U2', 'cancelPayment', { paymentId: m3.paymentId }, 'NOT_ALLOWED'); // 付款方不能撤销“已确认”
  const back = w.act('U1', 'cancelPayment', { paymentId: m3.paymentId }); // 收款方点错了，可以撤销
  assert.equal(back.view.settled, false);
});

test('结清后又改账会提示重新对账', () => {
  const { w, A, B, C } = twoPeopleOwing();
  const m = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10000 });
  assert.equal(w.act('U1', 'confirmPayment', { paymentId: m.paymentId }).view.changedAfterSettle, false);
  const r = w.act('U1', 'addExpense', { title: '补记门票', amountCents: 3000, payerId: A, splitMode: 'equal', date: '2026-11-02', participantIds: [A, B, C] });
  assert.equal(r.view.changedAfterSettle, true);
  assert.equal(r.view.settled, false);
  assert.ok(r.view.transfers.length > 0);
});

test('确认时账已经变了 → 要求重新标记', () => {
  const { w, A, B } = twoPeopleOwing();
  const m = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10000 });
  w.act('U1', 'deleteExpense', { expenseId: w.state.expenses[0].id });
  w.fails('U1', 'confirmPayment', { paymentId: m.paymentId }, 'STALE');
});

test('虚拟成员: 创建者可以代标记/代确认', () => {
  const { w, A, B, C } = setup();
  w.act('U1', 'addExpense', { title: '午饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  w.fails('U2', 'markPaid', { fromId: C, toId: A, amountCents: 3000 }, 'NOT_ALLOWED'); // 小乙不能代小丙
  const m = w.act('U1', 'markPaid', { fromId: C, toId: A, amountCents: 3000 }); // 创建者代虚拟的小丙
  w.act('U1', 'confirmPayment', { paymentId: m.paymentId }); // 收款人是创建者本人
  assert.equal(core.computeView(w.state, 'U1').balances[C], 0);
});

test('退出账本: 必须先对清账；账本里的旧记录保留；退出后读不到新账', () => {
  const { w, A, B, C } = twoPeopleOwing();
  w.fails('U2', 'removeMember', { memberId: B }, 'BALANCE_NOT_ZERO');
  const m = w.act('U2', 'markPaid', { fromId: B, toId: A, amountCents: 10000 });
  w.fails('U2', 'removeMember', { memberId: B }, 'BALANCE_NOT_ZERO'); // 还没确认
  w.act('U1', 'confirmPayment', { paymentId: m.paymentId });
  w.act('U2', 'removeMember', { memberId: B });
  const left = w.state.members.find((x) => x.id === B);
  assert.ok(left.leftAt);
  assert.equal(left.uid, null);
  w.fails('U2', 'getLedger', {}, 'NOT_MEMBER');
  w.fails('U2', 'addExpense', { title: 'x', amountCents: 100, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [A] }, 'NOT_MEMBER');
  assert.equal(w.state.expenses.length, 1); // 旧记录还在
  w.fails('U1', 'addExpense', { title: 'x', amountCents: 100, payerId: A, splitMode: 'equal', date: '2026-11-01', participantIds: [A, B] }, 'BAD_PARTICIPANT'); // 不能再把已退出的人加进新账
  w.fails('U1', 'removeMember', { memberId: A }, 'OWNER_CANNOT_LEAVE');
  void C;
});

test('移出成员: 只有创建者能移别人；没用过的虚拟成员直接删掉', () => {
  const { w, B, C } = setup();
  w.fails('U2', 'removeMember', { memberId: w.state.members.find((m) => m.role === 'owner').id }, 'OWNER_CANNOT_LEAVE');
  w.fails('U2', 'removeMember', { memberId: C }, 'NOT_ALLOWED');
  w.act('U1', 'removeMember', { memberId: C });
  assert.equal(w.state.members.find((m) => m.id === C), undefined);
  w.act('U1', 'removeMember', { memberId: B });
  assert.ok(w.state.members.find((m) => m.id === B).leftAt);
});

test('删除账本: 只有创建者', () => {
  const { w } = setup();
  w.fails('U2', 'deleteLedger', {}, 'NOT_OWNER');
  const out = core.run('deleteLedger', w.state, {}, { uid: 'U1', now: 1 });
  assert.equal(core.applyMutations(w.state, out.mutations).ledger, null);
});

test('视图里不含任何人的 uid', () => {
  const { w, A, B, C } = setup();
  w.act('U1', 'addExpense', { title: '午饭', amountCents: 9000, payerId: A, splitMode: 'equal', date: '2026-11-01', ...eq(A, B, C) });
  const s = JSON.stringify(core.computeView(w.state, 'U2'));
  ['U1', 'U2'].forEach((u) => assert.ok(!s.includes('"' + u + '"'), u));
  assert.equal(core.computeView(w.state, 'U2').me.isOwner, false);
});

test('未知操作 / 账本不存在', () => {
  assert.throws(() => core.run('hack', {}, {}, {}), { code: 'UNKNOWN_ACTION' });
  assert.throws(() => core.run('getLedger', null, {}, { uid: 'U1' }), { code: 'NOT_FOUND' });
});

test('注销账号: 匿名化；创建者注销则转交给最早的真人；没有别人就删除账本', () => {
  const { w } = setup();
  const muts = core.planAccountDeletion(w.state, 'U1', 5000);
  const next = core.applyMutations(w.state, muts);
  assert.equal(next.ledger.ownerUid, 'U2');
  assert.equal(next.members.find((m) => m.name === '小乙').role, 'owner');
  assert.ok(!next.members.some((m) => m.uid === 'U1'));
  assert.ok(next.members.some((m) => m.name === '已注销用户'));
  const solo = makeWorld();
  const o = core.run('createLedger', null, { name: 'a', myName: 'b' }, { uid: 'U1', now: 1, genId: solo.genId, genCode: solo.genCode });
  const st = core.applyMutations(null, o.mutations);
  assert.deepEqual(core.planAccountDeletion(st, 'U1', 2), [{ op: 'removeLedger', ledgerId: st.ledger.id }]);
  assert.deepEqual(core.planAccountDeletion(st, 'nobody', 2), []);
});

test('随机多人记账: 余额合计永远为 0，转账后全部结清', () => {
  const { w, A, B, C } = setup();
  const ids = [A, B, C];
  for (let i = 0; i < 60; i++) {
    const payer = ids[i % 3];
    const parts = ids.filter((_, k) => (i + k) % 3 !== 0 || i % 2);
    w.act('U1', 'addExpense', { title: '账' + i, amountCents: 100 + ((i * 7919) % 99999), payerId: payer, splitMode: 'equal', date: '2026-11-01', participantIds: parts.length ? parts : [A] });
  }
  const v = core.computeView(w.state, 'U1');
  assert.equal(Object.values(v.balances).reduce((a, b) => a + b, 0), 0);
  v.transfers.forEach((t) => {
    const from = w.state.members.find((m) => m.id === t.fromId);
    const uid = from.uid || 'U1';
    const m = w.act(uid, 'markPaid', { fromId: t.fromId, toId: t.toId, amountCents: t.amountCents });
    const to = w.state.members.find((x) => x.id === t.toId);
    w.act(to.uid || 'U1', 'confirmPayment', { paymentId: m.paymentId });
  });
  assert.equal(core.computeView(w.state, 'U1').settled, true);
});
