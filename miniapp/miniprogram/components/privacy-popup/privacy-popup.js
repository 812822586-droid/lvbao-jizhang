// 隐私同意弹窗。放在每个页面里；平时不显示，只在两种情况弹出:
//  1) 第一次打开小程序，用户还没同意《用户隐私保护指引》
//  2) 用户触发了需要隐私授权的微信接口，微信回调 wx.onNeedPrivacyAuthorization（见 app.js）
const app = getApp();

Component({
  data: { show: false },

  lifetimes: {
    attached() {
      this._listener = (show) => this.setData({ show: !!show });
      app.globalData.privacyListeners.push(this._listener);
      if (app.globalData.privacyResolve) { this.setData({ show: true }); return; }
      if (!app.globalData.privacyAsked && wx.getPrivacySetting) {
        app.globalData.privacyAsked = true;
        wx.getPrivacySetting({
          success: (res) => { if (res.needAuthorization) app.showPrivacy(true); },
          fail: () => {},
        });
      }
    },
    detached() {
      const arr = app.globalData.privacyListeners;
      const i = arr.indexOf(this._listener);
      if (i >= 0) arr.splice(i, 1);
    },
  },

  methods: {
    noop() {},
    openContract() {
      if (wx.openPrivacyContract) {
        wx.openPrivacyContract({ fail: () => this.openPolicy() }); // 还没有在后台配置指引时(例如游客模式)，退回到小程序内的政策页
      } else {
        this.openPolicy();
      }
    },
    openPolicy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
    onAgree() {
      const resolve = app.globalData.privacyResolve;
      if (resolve) { resolve({ buttonId: 'agree-btn', event: 'agree' }); app.globalData.privacyResolve = null; }
      app.showPrivacy(false);
    },
    onDisagree() {
      const resolve = app.globalData.privacyResolve;
      if (resolve) { resolve({ event: 'disagree' }); app.globalData.privacyResolve = null; }
      app.showPrivacy(false);
      wx.showToast({ title: '不同意的话，部分功能用不了', icon: 'none' });
    },
  },
});
