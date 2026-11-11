'use strict';
// 云端模式: 所有共同账本的读写都通过云函数 `ledger`，由云函数检查「你是不是这个账本的成员」。
// 手机端不直接读写云数据库（数据库权限设为「所有用户不可读写」）。
function apiError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function createCloudBackend(wxCloud) {
  function invoke(name, action, params) {
    return wxCloud.callFunction({ name, data: { action, params: params || {} } }).then(
      (res) => {
        const r = (res && res.result) || {};
        if (!r.ok) throw apiError(r.code || 'SERVER', r.message || '出错了，请稍后再试');
        return r.result || {};
      },
      () => { throw apiError('NETWORK', '网络不太顺，请检查网络后再试'); }
    );
  }
  return {
    mode: 'cloud',
    call(action, params) { return invoke('ledger', action, params); },
    personal(action, params) { return invoke('personal', action, params); },
  };
}

module.exports = { createCloudBackend };
