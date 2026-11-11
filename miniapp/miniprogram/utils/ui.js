'use strict';
// 页面里常用的提示小工具
function toast(msg) {
  wx.showToast({ title: String(msg).slice(0, 40), icon: 'none', duration: 2500 });
}
function alert(msg, title) {
  wx.showModal({ title: title || '提示', content: String(msg), showCancel: false, confirmText: '知道了', confirmColor: '#0e6b3a' });
}
function showError(e) {
  alert((e && e.message) || '出错了，请稍后再试');
}
function confirm(title, content, confirmText, danger) {
  return new Promise((resolve) => {
    wx.showModal({
      title, content, confirmText: confirmText || '确定', cancelText: '取消',
      confirmColor: danger ? '#9a3412' : '#0e6b3a',
      success: (r) => resolve(!!r.confirm), fail: () => resolve(false),
    });
  });
}
module.exports = { toast, alert, showError, confirm };
