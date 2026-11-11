const api = require('../../services/api');
const profile = require('../../services/profile');
const ui = require('../../utils/ui');

Page({
  data: { state: 'loading', message: '', ledgerName: '', ownerName: '', memberCount: 0, claimable: [], claimId: '', already: false, nickname: '', busy: false },

  // 从微信里点开别人转发的卡片会进到这里，参数是 lid(账本编号) 和 code(邀请码)
  onLoad(options) {
    this.ledgerId = options.lid;
    this.code = options.code;
    this.setData({ nickname: profile.getNickname() });
    if (!this.ledgerId || !this.code) { this.setData({ state: 'error', message: '邀请链接不完整，请让朋友重新发一次。' }); return; }
    api.call('previewInvite', { ledgerId: this.ledgerId, code: this.code }).then((r) => {
      const p = r.preview;
      this.setData({ state: 'ready', ledgerName: p.ledgerName, ownerName: p.ownerName, memberCount: p.memberCount, claimable: p.claimable, already: p.alreadyMember });
    }).catch((e) => this.setData({ state: 'error', message: e.message || '打不开邀请' }));
  },

  onNickname(e) { this.setData({ nickname: e.detail.value }); },
  pickClaim(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ claimId: this.data.claimId === id ? '' : id });
  },

  join() {
    if (this.data.busy) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) { ui.toast('请先写你的昵称'); return; }
    this.setData({ busy: true });
    profile.setNickname(nickname);
    const params = { ledgerId: this.ledgerId, code: this.code, myName: nickname };
    if (this.data.claimId) params.claimMemberId = this.data.claimId;
    api.call('joinLedger', params).then(() => this.enter()).catch((e) => { this.setData({ busy: false }); ui.showError(e); });
  },

  enter() { wx.redirectTo({ url: '/pages/ledger/ledger?id=' + this.ledgerId }); },
  goHome() { wx.switchTab({ url: '/pages/index/index' }); },
});
