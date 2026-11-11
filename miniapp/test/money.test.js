const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../miniprogram/lib/money');

test('parseYuan: 正常金额变成整数分', () => {
  const cases = [['12', 1200], ['12.5', 1250], ['12.05', 1205], ['0.01', 1], ['.5', 50], ['5.', 500], ['1,234.56', 123456], ['¥ 99.9', 9990], ['１２．５', 1250], ['0.1', 10], ['0.30', 30]];
  cases.forEach(([inp, cents]) => assert.deepEqual(money.parseYuan(inp), { ok: true, cents }, inp));
});

test('parseYuan: 浮点陷阱 0.1+0.2、1.15*100 不出错', () => {
  assert.equal(money.parseYuan(0.1).cents + money.parseYuan(0.2).cents, 30);
  assert.equal(money.parseYuan(1.15).cents, 115);
  assert.equal(money.parseYuan(19.99).cents, 1999);
  assert.equal(money.parseYuan(1.005).ok, false); // 三位小数不接受
});

test('parseYuan: 错误输入给出原因', () => {
  const bad = { '': 'empty', '   ': 'empty', abc: 'format', '1e5': 'format', '-5': 'format', '1.2.3': 'format', '1.234': 'decimals', '0': 'zero', '0.00': 'zero', '100000000': 'too_big', '99999999999999999999': 'too_big' };
  Object.keys(bad).forEach((k) => assert.deepEqual(money.parseYuan(k), { ok: false, reason: bad[k] }, JSON.stringify(k)));
  assert.equal(money.parseYuan(NaN).ok, false);
  assert.equal(money.parseYuan(null).reason, 'empty');
  assert.equal(money.parseYuan('99999999.99').cents, money.MAX_CENTS);
  money.parseYuan('x'); // 提示文字都存在
  ['empty', 'format', 'decimals', 'zero', 'too_big'].forEach((r) => assert.ok(money.amountErrorText(r).length > 2));
});

test('formatCents / centsToInput', () => {
  assert.equal(money.formatCents(0), '0.00');
  assert.equal(money.formatCents(5), '0.05');
  assert.equal(money.formatCents(-5), '-0.05');
  assert.equal(money.formatCents(123456789), '1,234,567.89');
  assert.equal(money.formatCents(123456789, { noComma: true }), '1234567.89');
  assert.equal(money.centsToInput(1200), '12');
  assert.equal(money.centsToInput(1250), '12.5');
  assert.equal(money.centsToInput(1205), '12.05');
  assert.equal(money.parseYuan(money.centsToInput(1205)).cents, 1205);
});

test('splitEqual: 100 元分 3 人 = 33.34 / 33.33 / 33.33，总额不变', () => {
  assert.deepEqual(money.splitEqual(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(money.splitEqual(300, 3), [100, 100, 100]);
  assert.deepEqual(money.splitEqual(1, 3), [1, 0, 0]);
  assert.deepEqual(money.splitEqual(5, 1), [5]);
  assert.deepEqual(money.splitEqual(0, 2), [0, 0]);
});

test('splitEqual: 随机检验——合计恒等于总额，任意两人相差不超过 1 分', () => {
  for (let i = 0; i < 2000; i++) {
    const total = Math.floor(Math.random() * 1e8) + 1;
    const n = Math.floor(Math.random() * 30) + 1;
    const parts = money.splitEqual(total, n);
    assert.equal(parts.length, n);
    assert.equal(money.sum(parts), total);
    assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
  }
});

test('splitEqual: 非法参数会报错', () => {
  assert.throws(() => money.splitEqual(1.5, 2));
  assert.throws(() => money.splitEqual(-1, 2));
  assert.throws(() => money.splitEqual(10, 0));
});
