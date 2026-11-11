'use strict';
// 页面只和这个文件打交道: api.call('addExpense', {...})
// 没配云环境 -> 本机体验模式；配了 -> 云端模式。两种模式用法完全一样。
const config = require('../config');
const { createWxStorage } = require('./storage');
const { createLocalBackend } = require('./localBackend');
const { createCloudBackend } = require('./cloudBackend');

let backend = null;

function init() {
  if (backend) return backend;
  if (config.CLOUD_ENV && typeof wx !== 'undefined' && wx.cloud) {
    try {
      wx.cloud.init({ env: config.CLOUD_ENV, traceUser: false });
      backend = createCloudBackend(wx.cloud);
      return backend;
    } catch (e) { /* 云初始化失败就退回本机模式 */ }
  }
  backend = createLocalBackend(createWxStorage(wx));
  return backend;
}

module.exports = {
  init,
  mode() { return init().mode; },
  call(action, params) { return init().call(action, params); },
  // 个人账本云备份，只有云端模式才有
  personal(action, params) {
    const b = init();
    if (!b.personal) return Promise.reject(Object.assign(new Error('本机体验模式没有云备份'), { code: 'LOCAL_MODE' }));
    return b.personal(action, params);
  },
};
