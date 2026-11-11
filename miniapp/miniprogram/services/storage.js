'use strict';
// 对 wx 本地存储的薄封装（同步，出错不抛）。测试里可以换成内存版。
function createWxStorage(wxApi) {
  return {
    get(key) {
      try { const v = wxApi.getStorageSync(key); return v === '' ? null : v; } catch (e) { return null; }
    },
    set(key, value) {
      try { wxApi.setStorageSync(key, value); return true; } catch (e) { return false; }
    },
    remove(key) { try { wxApi.removeStorageSync(key); } catch (e) { /* ignore */ } },
    keys() { try { return wxApi.getStorageInfoSync().keys || []; } catch (e) { return []; } },
  };
}

function createMemoryStorage() {
  const m = {};
  return {
    get(key) { return Object.prototype.hasOwnProperty.call(m, key) ? JSON.parse(JSON.stringify(m[key])) : null; },
    set(key, value) { m[key] = JSON.parse(JSON.stringify(value)); return true; },
    remove(key) { delete m[key]; },
    keys() { return Object.keys(m); },
  };
}

module.exports = { createWxStorage, createMemoryStorage };
