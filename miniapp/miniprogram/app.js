const api = require('./services/api');

App({
  globalData: { privacyResolve: null, privacyListeners: [], privacyAsked: false },

  onLaunch() {
    api.init(); // 没配云环境 = 本机体验模式
    // 微信要求: 用到隐私接口前，必须先让用户同意《隐私保护指引》。
    // 用户触发这类接口时微信会回调这里，我们弹出自己的同意弹窗（components/privacy-popup）。
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this.globalData.privacyResolve = resolve;
        this.showPrivacy(true);
      });
    }
  },

  showPrivacy(show) {
    this.globalData.privacyListeners.forEach((fn) => fn(show));
  },
});
