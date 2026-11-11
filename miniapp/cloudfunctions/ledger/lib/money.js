'use strict';
// 金额一律用「分」(整数)计算，永远不用小数做加减，避免 0.1+0.2 这类误差。
// 本文件同时被小程序和 node 测试使用，所以只用 CommonJS。

const MAX_CENTS = 9999999999; // 99,999,999.99 元

function normalizeDigits(s) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// 把用户输入的「元」解析成「分」。成功: {ok:true, cents}；失败: {ok:false, reason}
function parseYuan(input) {
  let s;
  if (typeof input === 'number') {
    if (!isFinite(input)) return { ok: false, reason: 'format' };
    if (Math.abs(input * 100 - Math.round(input * 100)) > 1e-6) return { ok: false, reason: 'decimals' };
    s = (Math.round(input * 100) / 100).toFixed(2);
  } else {
    s = normalizeDigits(String(input == null ? '' : input));
    s = s.replace(/[\s,，¥￥]/g, '').replace(/。/g, '.').replace(/．/g, '.');
  }
  if (s === '') return { ok: false, reason: 'empty' };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, reason: 'format' };
  const parts = s.split('.');
  const intPart = parts[0] || '0';
  const frac = parts[1] || '';
  if (frac.length > 2) return { ok: false, reason: 'decimals' };
  if (intPart.replace(/^0+/, '').length > 10) return { ok: false, reason: 'too_big' };
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (cents <= 0) return { ok: false, reason: 'zero' };
  if (cents > MAX_CENTS) return { ok: false, reason: 'too_big' };
  return { ok: true, cents };
}

const REASON_TEXT = {
  empty: '请先填金额',
  format: '金额只能写数字，例如 12.5',
  decimals: '金额最多两位小数',
  zero: '金额要大于 0',
  too_big: '金额太大了',
};
function amountErrorText(reason) {
  return REASON_TEXT[reason] || '金额不对';
}

function addThousands(s) {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 12345 -> "123.45"；-5 -> "-0.05"；带千分位: 1234567 -> "12,345.67"
function formatCents(cents, opts) {
  const o = opts || {};
  const n = Math.round(Number(cents) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const w = o.noComma ? String(whole) : addThousands(String(whole));
  return (neg ? '-' : '') + w + '.' + frac;
}

// 给输入框回填用: 1200 -> "12"，1250 -> "12.5"，1205 -> "12.05"
function centsToInput(cents) {
  const s = formatCents(cents, { noComma: true });
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

// 把 total 分平均分给 n 个人，返回长度 n 的整数数组，合计一定等于 total。
// 尾差规则: 多出来的几分钱，从第 1 位开始每人多 1 分（所以 100 元分 3 人 = 33.34 / 33.33 / 33.33）。
function splitEqual(total, n) {
  if (!Number.isInteger(total) || total < 0) throw new Error('total must be a non-negative integer');
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be >= 1');
  const base = Math.floor(total / n);
  const rem = total - base * n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

function sum(arr) {
  let t = 0;
  for (let i = 0; i < arr.length; i++) t += arr[i];
  return t;
}

module.exports = { MAX_CENTS, parseYuan, amountErrorText, formatCents, centsToInput, splitEqual, sum };
