const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStorage } = require('../miniprogram/services/storage');
const { createLocalBackend } = require('../miniprogram/services/localBackend');
const personalStoreMod = require('../miniprogram/services/personalStore');
const { createMockDb } = require('../testlib/mockdb');
const ledgerFn = require('../cloudfunctions/ledger/handler');
const personalFn = require('../cloudfunctions/personal/handler');

function deterministic() {
  let n = 0; let t = 1000;
  return { now: () => (t += 1000), genId: () => 'id' + (++n), genCode: () => 'CODE' + (++n) };
}

test('本机模式: 建账本 → 记账 → 结算 → 标记/确认 全流程，且重启后数据还在', async () => {
  const storage = createMemoryStorage();
  let b = createLocalBackend(storage, deterministic());
  const { ledgerId } = await b.call('createLedger', { name: '聚餐', myName: '我', clientId: 'k1' });
  assert.equal((await b.call('createLedger', { name: '聚餐', myName: '我', clientId: 'k1' })).duplicate, true);
  assert.equal((await b.call('listLedgers')).ledgers.length, 1);
  const r1 = await b.call('addVirtualMember', { ledgerId, name: '小红' });
  const me = r1.view.members.find((m) => m.isMe).id;
  const hong = r1.memberId;
  const r2 = await b.call('addExpense', { ledgerId, title: '火锅', amountCents: 20000, payerId: me, splitMode: 'equal', participantIds: [me, hong], date: '2026-11-05' });
  assert.deepEqual(r2.view.transfers.map((t) => [t.fromId, t.toId, t.amountCents]), [[hong, me, 10000]]);
  b = createLocalBackend(storage, deterministic()); // 模拟重新打开小程序
  const v = (await b.call('getLedger', { ledgerId })).view;
  assert.equal(v.totalSpentCents, 20000);
  const m = await b.call('markPaid', { ledgerId, fromId: hong, toId: me, amountCents: 10000 }); // 我代虚拟成员标记
  const c = await b.call('confirmPayment', { ledgerId, paymentId: m.paymentId });
  assert.equal(c.view.settled, true);
  assert.equal((await b.call('listLedgers')).ledgers[0].settled, true);
  await b.call('deleteLedger', { ledgerId });
  assert.equal((await b.call('listLedgers')).ledgers.length, 0);
  await assert.rejects(b.call('getLedger', { ledgerId }), { code: 'NOT_FOUND' });
});

test('本机模式: 不能加入别人的账本；错误带 code；deleteMyData 清空', async () => {
  const storage = createMemoryStorage();
  const b = createLocalBackend(storage, deterministic());
  await assert.rejects(b.call('joinLedger', { ledgerId: 'x', code: 'y' }), { code: 'LOCAL_MODE' });
  await assert.rejects(b.call('createLedger', { name: '', myName: 'a' }), { code: 'BAD_NAME' });
  await b.call('createLedger', { name: 'a', myName: 'b' });
  await b.call('deleteMyData');
  assert.equal((await b.call('listLedgers')).ledgers.length, 0);
});

test('云函数(假数据库): 多个用户走完 创建 → 邀请加入 → 记账 → 结清，权限由云端把关', async () => {
  const db = createMockDb();
  const d = deterministic();
  const call = (uid, action, params) => ledgerFn.handle(db, { action, params }, uid, d);
  const c = await call('U1', 'createLedger', { name: '旅行', myName: '甲', clientId: 'k' });
  assert.equal(c.ok, true);
  const L = c.result.ledgerId;
  assert.equal((await call('U1', 'createLedger', { name: '旅行', myName: '甲', clientId: 'k' })).result.duplicate, true);
  assert.equal(db.dump('ledgers').length, 1);
  const code = db.dump('ledgers')[0].inviteCode;

  assert.equal((await call('U2', 'getLedger', { ledgerId: L })).code, 'NOT_MEMBER');
  const pv = await call('U2', 'previewInvite', { ledgerId: L, code });
  assert.equal(pv.result.preview.ledgerName, '旅行');
  assert.equal((await call('U2', 'joinLedger', { ledgerId: L, code: 'bad', myName: '乙' })).code, 'INVITE_INVALID');
  const j = await call('U2', 'joinLedger', { ledgerId: L, code, myName: '乙' });
  assert.equal(j.ok, true);

  const view = (await call('U1', 'getLedger', { ledgerId: L })).result.view;
  const A = view.members.find((m) => m.name === '甲').id;
  const B = view.members.find((m) => m.name === '乙').id;
  const e = await call('U2', 'addExpense', { ledgerId: L, title: '酒店', amountCents: 30000, payerId: B, splitMode: 'equal', participantIds: [A, B], date: '2026-11-06' });
  assert.equal(e.ok, true);
  assert.equal(e.result.view.transfers[0].amountCents, 15000);
  // 改参与人: 用 command.set 整体替换 shares
  const u = await call('U2', 'updateExpense', { ledgerId: L, expenseId: e.result.expenseId, rev: 1, title: '酒店', amountCents: 30000, payerId: B, splitMode: 'equal', participantIds: [B], date: '2026-11-06' });
  assert.equal(u.ok, true);
  assert.deepEqual(Object.keys(db.dump('expenses')[0].shares), [B]);
  assert.equal((await call('U1', 'updateExpense', { ledgerId: L, expenseId: e.result.expenseId, rev: 1, title: 'x', amountCents: 1, payerId: B, splitMode: 'equal', participantIds: [B], date: '2026-11-06' })).code, 'CONFLICT');
  assert.equal((await call('U3', 'addExpense', { ledgerId: L, title: 'x', amountCents: 100, payerId: A, splitMode: 'equal', participantIds: [A], date: '2026-11-06' })).code, 'NOT_MEMBER');

  const list = (await call('U2', 'listLedgers', {})).result.ledgers;
  assert.equal(list.length, 1);
  assert.equal((await call('U3', 'listLedgers', {})).result.ledgers.length, 0);
  assert.equal((await call(null, 'listLedgers', {})).code, 'NO_LOGIN');
  assert.equal((await call('U1', 'getLedger', { ledgerId: '../../x' })).code, 'NOT_FOUND');
  assert.equal((await call('U1', 'nope', {})).code, 'UNKNOWN_ACTION');
  // 文档里有没有泄露
  assert.ok(db.dump('members').every((m) => m._id === m.id));
  // 注销: 创建者注销，账本转给乙
  assert.equal((await call('U1', 'deleteMyData', {})).ok, true);
  assert.equal(db.dump('ledgers')[0].ownerUid, 'U2');
  assert.ok(!db.dump('members').some((m) => m.uid === 'U1'));
  // 乙再注销: 没有真人了，账本整个删除
  await call('U2', 'deleteMyData', {});
  assert.equal(db.dump('ledgers').length, 0);
  assert.equal(db.dump('members').length, 0);
  assert.equal(db.dump('expenses').length, 0);
});

test('云函数: 删除账本会清掉所有关联文档', async () => {
  const db = createMockDb();
  const d = deterministic();
  const call = (uid, action, params) => ledgerFn.handle(db, { action, params }, uid, d);
  const L = (await call('U1', 'createLedger', { name: 'a', myName: 'b' })).result.ledgerId;
  const A = (await call('U1', 'getLedger', { ledgerId: L })).result.view.me.memberId;
  await call('U1', 'addExpense', { ledgerId: L, title: 't', amountCents: 100, payerId: A, splitMode: 'equal', participantIds: [A], date: '2026-11-06' });
  assert.equal((await call('U1', 'deleteLedger', { ledgerId: L })).ok, true);
  ['ledgers', 'members', 'expenses', 'payments'].forEach((c) => assert.equal(db.dump(c).length, 0));
});

test('云函数: 一个账本超过 100 条记录也能完整读出(分页)', async () => {
  const db = createMockDb();
  const d = deterministic();
  const call = (uid, action, params) => ledgerFn.handle(db, { action, params }, uid, d);
  const L = (await call('U1', 'createLedger', { name: 'a', myName: 'b' })).result.ledgerId;
  const A = (await call('U1', 'getLedger', { ledgerId: L })).result.view.me.memberId;
  for (let i = 0; i < 230; i++) await call('U1', 'addExpense', { ledgerId: L, clientId: 'c' + i, title: 't' + i, amountCents: 100, payerId: A, splitMode: 'equal', participantIds: [A], date: '2026-11-06' });
  const v = (await call('U1', 'getLedger', { ledgerId: L })).result.view;
  assert.equal(v.expenses.length, 230);
  assert.equal(v.totalSpentCents, 23000);
});

test('云备份函数: 推送 → 拉取 → 删除；坏数据被过滤；超量被拒', async () => {
  const db = createMockDb();
  const call = (uid, action, params) => personalFn.handle(db, { action, params }, uid, { now: () => 42 });
  const good = { id: 'r1', type: 'expense', amountCents: 500, category: '餐饮', date: '2026-11-01', note: '' };
  const p = await call('U1', 'pushBackup', { records: [good, good, { type: 'bad' }] });
  assert.deepEqual(p.result, { count: 1, updatedAt: 42 });
  assert.equal((await call('U1', 'pullBackup', {})).result.records.length, 1);
  assert.equal((await call('U2', 'pullBackup', {})).result.records.length, 0);
  assert.equal((await call('U1', 'pushBackup', { records: new Array(3001).fill(good) })).code, 'TOO_MANY');
  assert.equal((await call('U1', 'pushBackup', {})).code, 'BAD_REQUEST');
  assert.equal((await call('U1', 'deleteBackup', {})).ok, true);
  assert.equal((await call('U1', 'pullBackup', {})).result.records.length, 0);
  assert.equal((await call('U1', 'deleteBackup', {})).ok, true);
  assert.equal((await call(undefined, 'pullBackup', {})).code, 'NO_LOGIN');
});

test('个人账本存储: 增改删、合并导入、数据损坏时先备份再重来', () => {
  const storage = createMemoryStorage();
  const s = personalStoreMod.create(storage, deterministic());
  const r = s.add({ type: 'expense', amountCents: 1250, category: '餐饮', date: '2026-11-03', note: '午饭' });
  assert.equal(s.load().records.length, 1);
  const u = s.update(r.id, { type: 'expense', amountCents: 1300, category: '交通', date: '2026-11-03', note: '' });
  assert.equal(u.amountCents, 1300);
  assert.equal(u.createdAt, r.createdAt);
  assert.throws(() => s.add({ type: 'expense', amountCents: 0, date: '2026-11-03' }));
  assert.throws(() => s.update('nope', { type: 'expense', amountCents: 5, date: '2026-11-03' }));
  const m = s.mergeIn([r, { id: 'w1', type: 'income', amountCents: 100, category: '工资', date: '2026-11-04', note: '', createdAt: 1, updatedAt: 1 }]);
  assert.deepEqual([m.added, m.duplicate], [1, 1]);
  assert.equal(s.remove(r.id), 1);
  assert.equal(s.load().records.length, 1);
  storage.set(s.KEY, { version: 1, records: 'oops' });
  const l = s.load();
  assert.equal(l.records.length, 0);
  assert.match(l.notice, /损坏/);
  assert.ok(storage.keys().some((k) => k.indexOf('.broken.') > 0)); // 原文备份还在
});
