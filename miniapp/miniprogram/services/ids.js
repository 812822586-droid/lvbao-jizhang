'use strict';
// 生成 id 和邀请码（本机模式用；云函数里用更安全的随机数）
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
// 去掉容易看错的字符 0O1IL
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode(len) {
  let s = '';
  for (let i = 0; i < (len || 8); i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}
module.exports = { genId, genCode };
