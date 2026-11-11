const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../miniprogram/lib/records');

const mk = (o) => R.normalizeRecord(Object.assign({ type: 'expense', amountCents: 1000, category: '餐饮', date: '2026-11-03', id: 'r' + Math.random().toString(36).slice(2) }, o));

test('normalizeRecord: 网页版格式(元、中文类型)能转成分', () => {
  const r = R.normalizeRecord({ id: 'abc', type: '支出', amount: 12.5, category: '餐饮', date: '2026/11/3', note: '午饭\n加蛋', createdAt: 5 });
  assert.deepEqual(r, { id: 'abc', type: 'expense', amountCents: 1250, category: '餐饮', date: '2026-11-03', note: '午饭 加蛋', createdAt: 5, updatedAt: 5 });
  assert.equal(R.normalizeRecord({ type: 'income', amount: '1,200.50', date: '2026-01-02', id: 'x' }).amountCents, 120050);
});

test('normalizeRecord: 坏数据返回 null', () => {
  const bad = [null, 'x', { type: 'x', amount: 1, date: '2026-01-01', id: 'a' }, { type: 'income', amount: 0, date: '2026-01-01', id: 'a' }, { type: 'income', amount: 5, date: '2026-13-01', id: 'a' }, { type: 'income', amount: 5, date: '2026-02-30', id: 'a' }, { type: 'income', amount: 5, date: '', id: 'a' }, { type: 'income', amount: 5, date: '2026-01-01' }, { type: 'income', amountCents: 1.5, date: '2026-01-01', id: 'a' }, { type: 'income', amount: 1e12, date: '2026-01-01', id: 'a' }];
  bad.forEach((b) => assert.equal(R.normalizeRecord(b), null, JSON.stringify(b)));
});

test('月汇总和分类统计只用整数分', () => {
  const list = [mk({ amountCents: 1010 }), mk({ amountCents: 2020, category: '交通' }), mk({ type: 'income', amountCents: 500000, category: '工资' }), mk({ date: '2026-10-31', amountCents: 99900 })];
  const s = R.monthSummary(list, '2026-11');
  assert.deepEqual(s, { incomeCents: 500000, expenseCents: 3030, balanceCents: 496970 });
  const b = R.categoryBreakdown(list, '2026-11');
  assert.deepEqual(b.map((x) => [x.name, x.cents]), [['交通', 2020], ['餐饮', 1010]]);
  assert.equal(b[0].percent + b[1].percent >= 99, true);
  assert.equal(R.categoryBreakdown([], '2026-11').length, 0);
});

test('月份计算', () => {
  assert.equal(R.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(R.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(R.shiftMonth('2026-11', 14), '2028-01');
  assert.equal(R.monthLabel('2026-03'), '2026年3月');
  assert.equal(R.todayStr(new Date(2026, 0, 5).getTime()), '2026-01-05');
});

test('合并导入: 按 id 去重，重复导入不会重复记账；超过上限不收', () => {
  const a = [mk({ id: 'a' }), mk({ id: 'b' })];
  const inc = [mk({ id: 'b' }), mk({ id: 'c' })];
  const r1 = R.mergeRecords(a, inc);
  assert.deepEqual([r1.added, r1.duplicate, r1.records.length], [1, 1, 3]);
  const r2 = R.mergeRecords(r1.records, inc);
  assert.deepEqual([r2.added, r2.duplicate, r2.records.length], [0, 2, 3]);
  const r3 = R.mergeRecords(a, [mk({ id: 'x' }), mk({ id: 'y' })], 3);
  assert.deepEqual([r3.added, r3.overLimit, r3.records.length], [1, 1, 3]);
});

test('parseWebBackup: 读网页版备份', () => {
  const text = JSON.stringify({ app: '绿宝记账', version: 1, records: [{ id: 'w1', type: 'expense', amount: 12.5, category: '餐饮', date: '2026-11-01', note: '', createdAt: 1 }, { id: 'w1', type: 'expense', amount: 1, date: '2026-11-01' }, { type: 'bad' }] });
  const r = R.parseWebBackup('\uFEFF' + text);
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.records[0].amountCents, 1250);
  assert.ok(R.parseWebBackup('not json').error);
  assert.ok(R.parseWebBackup('{"a":1}').error);
  assert.equal(R.parseWebBackup('[]').records.length, 0);
});

test('CSV 导出: 引号、逗号、换行转义，防公式注入', () => {
  const csv = R.toCsv([mk({ id: 'z', note: '=HYPERLINK("x")', amountCents: 1205 }), mk({ id: 'y', note: 'a,b', date: '2026-11-04' })]);
  assert.ok(csv.startsWith('\uFEFF日期,类型,分类,金额(元),备注'));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('12.05'));
  assert.equal(R.csvCell('+1'), "'+1");
  assert.equal(R.csvCell('正常'), '正常');
});

test('分类颜色: 已知分类用网页版颜色，未知分类稳定', () => {
  assert.equal(R.categoryColor('餐饮'), '#2F9E5A');
  assert.equal(R.categoryColor('宠物'), R.categoryColor('宠物'));
});
