const test = require('node:test');
const assert = require('node:assert/strict');
const settle = require('../miniprogram/lib/settle');

function apply(balances, transfers) {
  const b = Object.assign({}, balances);
  transfers.forEach((t) => { b[t.fromId] += t.amountCents; b[t.toId] -= t.amountCents; });
  return b;
}

// 独立的「笨办法」: 枚举所有分组方式，找出最多能分成几个“内部合计为零”的小组。
// 理论: 需要 n 个人转账时，最少转账次数 = n - 最多零和小组数。
function bruteMinTransfers(balances) {
  const ids = Object.keys(balances).filter((k) => balances[k] !== 0);
  let best = 0;
  function go(i, groups) {
    if (i === ids.length) {
      if (groups.every((g) => g.sum === 0)) best = Math.max(best, groups.length);
      return;
    }
    for (let g = 0; g < groups.length; g++) {
      groups[g].sum += balances[ids[i]];
      go(i + 1, groups);
      groups[g].sum -= balances[ids[i]];
    }
    groups.push({ sum: balances[ids[i]] });
    go(i + 1, groups);
    groups.pop();
  }
  if (!ids.length) return 0;
  go(0, []);
  return ids.length - best;
}

test('验收用例: 甲付 300 住宿，乙付 120 餐费，三人平分 → 乙给甲 20，丙给甲 140', () => {
  const expenses = [
    { id: 'e1', title: '住宿', payerId: 'A', amountCents: 30000, shares: { A: 10000, B: 10000, C: 10000 } },
    { id: 'e2', title: '餐费', payerId: 'B', amountCents: 12000, shares: { A: 4000, B: 4000, C: 4000 } },
  ];
  const bal = settle.computeBalances(['A', 'B', 'C'], expenses, []);
  assert.deepEqual(bal, { A: 16000, B: -2000, C: -14000 });
  const t = settle.minimalTransfers(bal, ['A', 'B', 'C']);
  assert.deepEqual(t, [{ fromId: 'C', toId: 'A', amountCents: 14000 }, { fromId: 'B', toId: 'A', amountCents: 2000 }]);
  assert.deepEqual(apply(bal, t), { A: 0, B: 0, C: 0 });
});

test('没人欠钱时没有转账；全 0 余额', () => {
  assert.deepEqual(settle.minimalTransfers({ A: 0, B: 0 }, ['A', 'B']), []);
  assert.deepEqual(settle.minimalTransfers({}, []), []);
});

test('两个人: 一笔转账', () => {
  assert.deepEqual(settle.minimalTransfers({ A: 500, B: -500 }, ['A', 'B']), [{ fromId: 'B', toId: 'A', amountCents: 500 }]);
});

test('贪心不是最少的例子: 精确算法比贪心少转账', () => {
  // {+5,-5} 和 {+7,-3,-4} 两个独立小组 → 最少 1 + 2 = 3 笔
  const bal = { a: 500, b: -500, c: 700, d: -300, e: -400 };
  const order = ['a', 'b', 'c', 'd', 'e'];
  const exact = settle.minimalTransfers(bal, order);
  const ids = order.filter((i) => bal[i] !== 0);
  const rank = {}; order.forEach((id, i) => { rank[id] = i; });
  const greedy = settle.greedyTransfers(ids, bal, rank);
  assert.equal(exact.length, 3);
  assert.ok(greedy.length > exact.length, 'greedy=' + greedy.length);
  assert.deepEqual(apply(bal, exact), { a: 0, b: 0, c: 0, d: 0, e: 0 });
});

test('随机检验(≤7 人): 转账次数等于枚举出的最少次数，且全部结清', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let iter = 0; iter < 300; iter++) {
    const n = 2 + Math.floor(rnd() * 6);
    const ids = []; for (let i = 0; i < n; i++) ids.push('m' + i);
    const bal = {}; let s = 0;
    ids.forEach((id, i) => {
      if (i === n - 1) { bal[id] = -s; return; }
      // 小数值，让“凑零”小组经常出现
      bal[id] = Math.floor(rnd() * 9 - 4) * 100; s += bal[id];
    });
    const t = settle.minimalTransfers(bal, ids);
    assert.deepEqual(Object.values(apply(bal, t)).filter((v) => v !== 0), [], JSON.stringify(bal));
    assert.equal(t.length, bruteMinTransfers(bal), JSON.stringify(bal));
    t.forEach((x) => { assert.ok(x.amountCents > 0); assert.notEqual(x.fromId, x.toId); assert.ok(bal[x.fromId] < 0 && bal[x.toId] > 0); });
  }
});

test('随机检验(大金额、多人): 总是结清，且不超过 n-1 笔', () => {
  for (let iter = 0; iter < 100; iter++) {
    const n = 2 + Math.floor(Math.random() * 15);
    const ids = []; for (let i = 0; i < n; i++) ids.push('m' + i);
    const bal = {}; let s = 0;
    ids.forEach((id, i) => { bal[id] = i === n - 1 ? -s : Math.floor(Math.random() * 2e9) - 1e9; s += bal[id]; });
    const t = settle.minimalTransfers(bal, ids);
    assert.ok(Object.values(apply(bal, t)).every((v) => v === 0));
    assert.ok(t.length <= n - 1);
  }
});

test('超过 16 人走贪心兜底，仍然结清', () => {
  const ids = []; const bal = {}; let s = 0;
  for (let i = 0; i < 24; i++) { const id = 'p' + i; ids.push(id); bal[id] = i === 23 ? -s : (i % 2 ? -1 : 1) * (100 + i * 7); s += bal[id]; }
  const t = settle.minimalTransfers(bal, ids);
  assert.ok(Object.values(apply(bal, t)).every((v) => v === 0));
});

test('结果每次一样（和输入的键顺序无关）', () => {
  const a = settle.minimalTransfers({ x: 300, y: -100, z: -200 }, ['x', 'y', 'z']);
  const b = settle.minimalTransfers({ z: -200, y: -100, x: 300 }, ['x', 'y', 'z']);
  assert.deepEqual(a, b);
});

test('余额合计不为 0 或有小数会报错', () => {
  assert.throws(() => settle.minimalTransfers({ a: 100, b: -50 }, ['a', 'b']));
  assert.throws(() => settle.minimalTransfers({ a: 100.5, b: -100.5 }, ['a', 'b']));
});

test('已确认的转账会计入余额；未确认的不算；已删除的账不算', () => {
  const ex = [{ id: 'e', title: 't', payerId: 'A', amountCents: 200, shares: { A: 100, B: 100 } }, { id: 'd', title: 'x', payerId: 'B', amountCents: 999, shares: { A: 999 }, deletedAt: 1 }];
  assert.deepEqual(settle.computeBalances(['A', 'B'], ex, []), { A: 100, B: -100 });
  assert.deepEqual(settle.computeBalances(['A', 'B'], ex, [{ fromId: 'B', toId: 'A', amountCents: 100, status: 'paid' }]), { A: 100, B: -100 });
  assert.deepEqual(settle.computeBalances(['A', 'B'], ex, [{ fromId: 'B', toId: 'A', amountCents: 100, status: 'confirmed' }]), { A: 0, B: 0 });
});

test('explainMember: 能说清为什么是这个数', () => {
  const ex = [
    { id: 'e1', title: '住宿', payerId: 'A', amountCents: 30000, shares: { A: 10000, B: 10000, C: 10000 } },
    { id: 'e2', title: '餐费', payerId: 'B', amountCents: 12000, shares: { A: 4000, B: 4000, C: 4000 } },
  ];
  const x = settle.explainMember('B', ex, [{ fromId: 'B', toId: 'A', amountCents: 500, status: 'confirmed' }]);
  assert.equal(x.paidTotal, 12000);
  assert.equal(x.owedTotal, 14000);
  assert.equal(x.settledOut, 500);
  assert.equal(x.net, 12000 - 14000 + 500);
  assert.deepEqual(x.paid.map((p) => p.title), ['餐费']);
  assert.deepEqual(x.owed.map((p) => p.title), ['住宿', '餐费']);
});
