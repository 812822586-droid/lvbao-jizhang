'use strict';
// 昵称（用户自己填，只存在本机）
const { createWxStorage } = require('./storage');
const KEY = 'lvbao.profile.v1';
const storage = typeof wx !== 'undefined' ? createWxStorage(wx) : null;

module.exports = {
  getNickname() {
    const p = storage && storage.get(KEY);
    return p && typeof p.nickname === 'string' ? p.nickname : '';
  },
  setNickname(name) {
    if (storage) storage.set(KEY, { nickname: String(name || '').trim().slice(0, 20) });
  },
  clear() { if (storage) storage.remove(KEY); },
};
