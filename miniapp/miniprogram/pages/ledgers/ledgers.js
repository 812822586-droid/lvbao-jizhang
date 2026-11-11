const api = require('../../services/api');
const profile = require('../../services/profile');
const money = require('../../lib/money');
const ui = require('../../utils/ui');
const ids = require('../../services/ids');

Page({
  data: { mode: '', list: [], loaded: false, showCreate: false, name: '', nickname: '', busy: false },

  onShow() {
    this.setData({ mode: api.mode(), nickname: this.data.nickname || profile.getNickname() });
    this.load();
  },

  load() {
    api.call('listLedgers').then((r) => {
      const list = r.ledgers.map((l) => Object.assign({}, l, { total: money.formatCents(l.totalSpentCents) }));
      this.setData({ list, loaded: true });
    }).catch((e) => { this.setData({ loaded: true }); ui.showError(e); });
  },

  openCreate() { this.clientId = ids.genId(); this.setData({ showCreate: true }); },
  closeCreate() { this.setData({ showCreate: false }); },
  onName(e) { this.setData({ name: e.detail.value }); },
  onNickname(e) { this.setData({ nickname: e.detail.value }); },

  create() {
    if (this.data.busy) return;
    const name = this.data.name.trim();
    const nickname = this.data.nickname.trim();
    if (!name) { ui.toast('请先写账本名字'); return; }
    if (!nickname) { ui.toast('请先写你的昵称'); return; }
    this.setData({ busy: true });
    profile.setNickname(nickname);
    // clientId 保证网络慢时重复点「创建」也只会建一个
    api.call('createLedger', { name, myName: nickname, clientId: this.clientId }).then((r) => {
      this.setData({ busy: false, showCreate: false, name: '' });
      wx.navigateTo({ url: '/pages/ledger/ledger?id=' + r.ledgerId });
    }).catch((e) => { this.setData({ busy: false }); ui.showError(e); });
  },

  open(e) { wx.navigateTo({ url: '/pages/ledger/ledger?id=' + e.currentTarget.dataset.id }); },
});
