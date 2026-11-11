'use strict';
// 个人记账: 记录整理、月汇总、分类统计、合并导入、CSV 导出。金额一律是整数「分」。
const money = require('./money');

const MAX_RECORDS = 3000;
const EXPENSE_CATEGORIES = ['餐饮', '交通', '购物', '住房', '娱乐', '其他'];
const INCOME_CATEGORIES = ['工资', '其他'];
// 颜色和网页版一致
const COLORS = { 餐饮: '#2F9E5A', 交通: '#2B7C9E', 购物: '#E09A3E', 住房: '#6E8B74', 娱乐: '#7D6BB0', 工资: '#C49214', 其他: '#8A8178' };
const EXTRA_COLORS = ['#3A7CA5', '#C47B4A', '#5E8F78', '#8B6BB5', '#3D9B8F'];

function categoryColor(name) {
  if (COLORS[name]) return COLORS[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}

function pad(n) { return n < 10 ? '0' + n : String(n); }

function todayStr(now) {
  const d = now ? new Date(now) : new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function isValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function monthOf(dateStr) { return String(dateStr).slice(0, 7); }

function shiftMonth(month, delta) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return ny + '-' + pad(nm + 1);
}

function monthLabel(month) { return month.slice(0, 4) + '年' + Number(month.slice(5, 7)) + '月'; }

function cleanLine(v, max) {
  return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanId(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : '';
}

// 接受: {type, amountCents|amount(元), category, date, note, id, createdAt}
// 也兼容网页版里的「收入/支出」中文类型。无效返回 null。
function normalizeRecord(item, opts) {
  const o = opts || {};
  if (!item || typeof item !== 'object') return null;
  let type = item.type;
  if (type === '收入') type = 'income';
  if (type === '支出') type = 'expense';
  if (type !== 'income' && type !== 'expense') return null;

  let cents;
  if (item.amountCents !== undefined) {
    cents = item.amountCents;
    if (!Number.isInteger(cents) || cents <= 0 || cents > money.MAX_CENTS) return null;
  } else {
    let a = item.amount;
    if (typeof a === 'number' && a < 0) a = -a;
    if (typeof a === 'string') a = a.replace(/^\s*-/, '');
    const r = money.parseYuan(typeof a === 'number' ? Math.round(a * 100) / 100 : a);
    if (!r.ok) return null;
    cents = r.cents;
  }

  let date = String(item.date || '').trim().replace(/[/.]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) return null;
  date = m[1] + '-' + pad(Number(m[2])) + '-' + pad(Number(m[3]));
  if (!isValidDate(date)) return null;

  let id = cleanId(item.id);
  if (!id) {
    if (!o.genId) return null;
    id = o.genId();
  }
  const category = cleanLine(item.category, 20) || '其他';
  const note = cleanLine(item.note, 100);
  const createdAt = Number.isFinite(Number(item.createdAt)) && Number(item.createdAt) > 0 ? Number(item.createdAt) : (o.now || Date.now());
  const updatedAt = Number.isFinite(Number(item.updatedAt)) && Number(item.updatedAt) > 0 ? Number(item.updatedAt) : createdAt;
  return { id, type, amountCents: cents, category, date, note, createdAt, updatedAt };
}

function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

function inMonth(records, month) {
  return records.filter((r) => monthOf(r.date) === month).sort(byNewest);
}

function monthSummary(records, month) {
  let income = 0; let expense = 0;
  inMonth(records, month).forEach((r) => {
    if (r.type === 'income') income += r.amountCents; else expense += r.amountCents;
  });
  return { incomeCents: income, expenseCents: expense, balanceCents: income - expense };
}

// 本月某类型(默认支出)按分类汇总，从多到少。percent 是整数百分比，仅用来画条的长度。
function categoryBreakdown(records, month, type) {
  const t = type || 'expense';
  const map = {};
  let total = 0;
  inMonth(records, month).forEach((r) => {
    if (r.type !== t) return;
    map[r.category] = (map[r.category] || 0) + r.amountCents;
    total += r.amountCents;
  });
  return Object.keys(map)
    .map((name) => ({ name, cents: map[name], percent: total ? Math.round((map[name] * 100) / total) : 0, color: categoryColor(name) }))
    .sort((a, b) => b.cents - a.cents || (a.name < b.name ? -1 : 1));
}

// 合并: 按 id 去重(重复导入不会重复记账)，超过上限的部分不收
function mergeRecords(existing, incoming, max) {
  const limit = max || MAX_RECORDS;
  const seen = {};
  const out = [];
  existing.forEach((r) => { if (!seen[r.id]) { seen[r.id] = true; out.push(r); } });
  let added = 0; let duplicate = 0; let overLimit = 0;
  incoming.forEach((r) => {
    if (seen[r.id]) { duplicate++; return; }
    if (out.length >= limit) { overLimit++; return; }
    seen[r.id] = true;
    out.push(r);
    added++;
  });
  return { records: out, added, duplicate, overLimit };
}

// 解析网页版「备份 JSON」的文本。返回 {records, skipped, error}
function parseWebBackup(text, opts) {
  let data;
  try { data = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { return { records: [], skipped: 0, error: '这个文件不是正确的 JSON 备份' }; }
  let list = null;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.records)) list = data.records;
  if (!list) return { records: [], skipped: 0, error: '文件里没有找到账目' };
  const records = []; let skipped = 0;
  const seen = {};
  list.forEach((it) => {
    const r = normalizeRecord(it, opts);
    if (!r || seen[r.id]) { skipped++; return; }
    seen[r.id] = true;
    records.push(r);
  });
  return { records, skipped, error: '' };
}

// 防止「公式注入」: 用表格软件打开时，以 = + - @ 开头的文字会被当公式执行
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(records) {
  const rows = [['日期', '类型', '分类', '金额(元)', '备注']];
  records.slice().sort(byNewest).forEach((r) => {
    rows.push([r.date, r.type === 'income' ? '收入' : '支出', r.category, money.formatCents(r.amountCents, { noComma: true }), r.note]);
  });
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  MAX_RECORDS, EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryColor,
  todayStr, isValidDate, monthOf, shiftMonth, monthLabel,
  normalizeRecord, byNewest, inMonth, monthSummary, categoryBreakdown,
  mergeRecords, parseWebBackup, toCsv, csvCell,
};
