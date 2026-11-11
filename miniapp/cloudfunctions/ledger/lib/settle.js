'use strict';
// AA 结算: 把「谁先垫了多少、谁该出多少」变成「谁转给谁多少」，并尽量少转几次。
// 全部用整数「分」。balance > 0 表示别人欠他钱(他是债主)，balance < 0 表示他欠别人钱。

const EXACT_LIMIT = 16; // 需要转账的人数不超过 16 时，用精确算法保证转账次数最少

function indexOfOrder(order) {
  const m = {};
  order.forEach((id, i) => { m[id] = i; });
  return m;
}

// 经典做法: 每次让「最多该收的人」和「最多该付的人」配对。最多 k-1 次，但不一定最少。
function greedyTransfers(ids, balances, rank) {
  const cred = [];
  const debt = [];
  ids.forEach((id) => {
    if (balances[id] > 0) cred.push({ id, amt: balances[id] });
    else if (balances[id] < 0) debt.push({ id, amt: -balances[id] });
  });
  const cmp = (a, b) => (b.amt - a.amt) || (rank[a.id] - rank[b.id]);
  const out = [];
  while (cred.length && debt.length) {
    cred.sort(cmp);
    debt.sort(cmp);
    const c = cred[0];
    const d = debt[0];
    const amt = Math.min(c.amt, d.amt);
    out.push({ fromId: d.id, toId: c.id, amountCents: amt });
    c.amt -= amt;
    d.amt -= amt;
    if (c.amt === 0) cred.shift();
    if (d.amt === 0) debt.shift();
  }
  return out;
}

// 把需要转账的人分成尽可能多的「内部刚好互相抵消」的小组。
// 一个 k 人小组只需要 k-1 笔转账，所以小组越多，总转账越少。
function zeroSumGroups(ids, balances) {
  const n = ids.length;
  const size = 1 << n;
  const sums = new Float64Array(size); // 金额最大约 1e10，超出 int32，所以用 Float64Array
  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const i = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + balances[ids[i]];
  }
  const dp = new Int16Array(size);
  const choice = new Int8Array(size);
  for (let mask = 1; mask < size; mask++) {
    let best = -1;
    let bi = -1;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        const v = dp[mask ^ (1 << i)];
        if (v > best) { best = v; bi = i; }
      }
    }
    dp[mask] = best + (sums[mask] === 0 ? 1 : 0);
    choice[mask] = bi;
  }
  const seq = [];
  let mask = size - 1;
  while (mask) {
    const i = choice[mask];
    seq.push(i);
    mask ^= 1 << i;
  }
  seq.reverse();
  const groups = [];
  let cur = [];
  let acc = 0;
  seq.forEach((i) => {
    cur.push(ids[i]);
    acc += balances[ids[i]];
    if (acc === 0) { groups.push(cur); cur = []; }
  });
  if (cur.length) groups.push(cur);
  return groups;
}

// balances: {成员id: 分}；order: 成员顺序（用来让结果每次都一样）
function minimalTransfers(balances, order) {
  const ord = (order || []).slice();
  Object.keys(balances).sort().forEach((id) => { if (ord.indexOf(id) < 0) ord.push(id); });
  const rank = indexOfOrder(ord);
  const ids = ord.filter((id) => balances[id] !== undefined && balances[id] !== 0);
  let s = 0;
  ids.forEach((id) => { s += balances[id]; });
  if (s !== 0) throw new Error('balances must sum to zero, got ' + s);
  ids.forEach((id) => { if (!Number.isInteger(balances[id])) throw new Error('balances must be integers'); });
  if (!ids.length) return [];
  const groups = ids.length <= EXACT_LIMIT ? zeroSumGroups(ids, balances) : [ids];
  let out = [];
  groups.forEach((g) => { out = out.concat(greedyTransfers(g, balances, rank)); });
  out.sort((a, b) => (b.amountCents - a.amountCents) || (rank[a.fromId] - rank[b.fromId]) || (rank[a.toId] - rank[b.toId]));
  return out;
}

// 余额 = 自己先付的 - 自己该出的，再把「已确认的转账」算进去
// expenses: [{payerId, amountCents, shares:{id:分}, deletedAt?}]
// payments: [{fromId,toId,amountCents,status}] 只有 status==='confirmed' 才算
function computeBalances(memberIds, expenses, payments) {
  const bal = {};
  memberIds.forEach((id) => { bal[id] = 0; });
  const add = (id, v) => { bal[id] = (bal[id] || 0) + v; };
  (expenses || []).forEach((e) => {
    if (e.deletedAt) return;
    add(e.payerId, e.amountCents);
    Object.keys(e.shares || {}).forEach((id) => add(id, -e.shares[id]));
  });
  (payments || []).forEach((p) => {
    if (p.status !== 'confirmed') return;
    add(p.fromId, p.amountCents);
    add(p.toId, -p.amountCents);
  });
  return bal;
}

// 某个人「为什么是这个数」: 他垫了哪几笔、该分摊哪几笔、已经转了多少
function explainMember(memberId, expenses, payments) {
  const paid = [];
  const owed = [];
  (expenses || []).forEach((e) => {
    if (e.deletedAt) return;
    if (e.payerId === memberId) paid.push({ expenseId: e.id, title: e.title, amountCents: e.amountCents });
    const sh = (e.shares || {})[memberId];
    if (sh) owed.push({ expenseId: e.id, title: e.title, shareCents: sh });
  });
  let settledOut = 0;
  let settledIn = 0;
  (payments || []).forEach((p) => {
    if (p.status !== 'confirmed') return;
    if (p.fromId === memberId) settledOut += p.amountCents;
    if (p.toId === memberId) settledIn += p.amountCents;
  });
  const paidTotal = paid.reduce((a, b) => a + b.amountCents, 0);
  const owedTotal = owed.reduce((a, b) => a + b.shareCents, 0);
  return { paid, owed, paidTotal, owedTotal, settledOut, settledIn, net: paidTotal - owedTotal + settledOut - settledIn };
}

module.exports = { EXACT_LIMIT, minimalTransfers, greedyTransfers, computeBalances, explainMember };
