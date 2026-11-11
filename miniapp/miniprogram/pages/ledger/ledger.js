const api = require('../../services/api');
const money = require('../../lib/money');
const ui = require('../../utils/ui');

Page({
  data: {
    ready: false, error: '', mode: '', name: '', total: '0.00', settled: false, statusText: '', changedAfterSettle: false,
    members: [], items: [], deleted: [], showDeleted: false, newMember: '', inviteActive: true, isOwner: false,
  },

  onLoad(options) {
    this.ledgerId = options.id;
    this.setData({ mode: api.mode() });
  },
  onShow() { this.load(); },

  load() {
    return api.call('getLedger', { ledgerId: this.ledgerId }).then((r) => this.render(r.view)).catch((e) => {
      this.setData({ error: e.message || '打不开这个账本' });
      if (e.code === 'NOT_MEMBER' || e.code === 'NOT_FOUND') {
        ui.alert(e.message);
      } else ui.showError(e);
    });
  },

  render(v) {
    this.view = v;
    const nameOf = {};
    v.members.forEach((m) => { nameOf[m.id] = m.name; });
    const isOwner = !!(v.me && v.me.isOwner);
    const members = v.members.filter((m) => !m.left).map((m) => ({
      id: m.id, name: m.name, isMe: m.isMe, role: m.role, virtual: m.virtual,
      canRemove: m.role !== 'owner' && (isOwner || m.isMe),
    }));
    const live = v.expenses.filter((e) => !e.deletedAt);
    const items = live.map((e) => ({
      id: e.id, title: e.title, date: e.date, amount: money.formatCents(e.amountCents), payerName: nameOf[e.payerId] || '?',
      partText: e.participantIds.length + ' 人分摊',
    }));
    const deleted = v.expenses.filter((e) => e.deletedAt).map((e) => ({ id: e.id, title: e.title, date: e.date, amount: money.formatCents(e.amountCents), canEdit: e.canEdit }));
    const statusText = v.settled ? '已结清' : (v.transfers.length ? '还有 ' + v.transfers.length + ' 笔要转账' : '还没有账目');
    wx.setNavigationBarTitle({ title: v.ledger.name });
    this.setData({
      ready: true, error: '', name: v.ledger.name, total: money.formatCents(v.totalSpentCents), settled: v.settled, statusText,
      changedAfterSettle: v.changedAfterSettle, members, items, deleted, inviteActive: v.ledger.inviteActive, isOwner,
    });
  },

  onNewMember(e) { this.setData({ newMember: e.detail.value }); },
  addMember() {
    const name = this.data.newMember.trim();
    if (!name) { ui.toast('请先写朋友的名字'); return; }
    api.call('addVirtualMember', { ledgerId: this.ledgerId, name }).then((r) => { this.setData({ newMember: '' }); this.render(r.view); }).catch(ui.showError);
  },
  removeMember(e) {
    const d = e.currentTarget.dataset;
    const me = d.me === true || d.me === 'true';
    ui.confirm(me ? '退出这个账本？' : '移出「' + d.name + '」？', me ? '退出后你看不到这个账本了；你已经记的账会留在账本里。需要先把账对清。' : '他之前记的账会保留。需要先把他的账对清。', me ? '退出' : '移出', true).then((ok) => {
      if (!ok) return null;
      return api.call('removeMember', { ledgerId: this.ledgerId, memberId: d.id }).then((r) => {
        if (me) { wx.navigateBack(); } else this.render(r.view);
      });
    }).catch(ui.showError);
  },

  addExpense() { wx.navigateTo({ url: '/pages/expense/expense?lid=' + this.ledgerId }); },
  editExpense(e) { wx.navigateTo({ url: '/pages/expense/expense?lid=' + this.ledgerId + '&eid=' + e.currentTarget.dataset.id }); },
  toggleDeleted() { this.setData({ showDeleted: !this.data.showDeleted }); },
  restoreExpense(e) {
    api.call('restoreExpense', { ledgerId: this.ledgerId, expenseId: e.currentTarget.dataset.id }).then((r) => this.render(r.view)).catch(ui.showError);
  },
  goSettle() { wx.navigateTo({ url: '/pages/settle/settle?id=' + this.ledgerId }); },

  rotateInvite() {
    ui.confirm('换一张新邀请？', '之前发出去的邀请卡片会作废。', '换新').then((ok) => {
      if (!ok) return null;
      return api.call('rotateInvite', { ledgerId: this.ledgerId }).then((r) => { this.render(r.view); ui.toast('已换新，请重新邀请'); });
    }).catch(ui.showError);
  },
  revokeInvite() {
    ui.confirm('停用邀请？', '停用后，没人能再通过邀请卡片加入。', '停用').then((ok) => {
      if (!ok) return null;
      return api.call('revokeInvite', { ledgerId: this.ledgerId }).then((r) => this.render(r.view));
    }).catch(ui.showError);
  },
  deleteLedger() {
    ui.confirm('删除整个账本？', '所有成员的这本账都会消失，不能恢复。', '删除', true).then((ok) => {
      if (!ok) return null;
      return api.call('deleteLedger', { ledgerId: this.ledgerId }).then(() => wx.navigateBack());
    }).catch(ui.showError);
  },

  // 点「邀请朋友」按钮时微信会问这里要分享卡片的内容。卡片里只放账本名字，不放金额。
  onShareAppMessage() {
    const v = this.view;
    if (!v || this.data.mode !== 'cloud') return { title: '绿宝记账：一起记账，轻松算清', path: '/pages/index/index' };
    return {
      title: '邀请你加入共同账本「' + v.ledger.name + '」',
      path: '/pages/join/join?lid=' + v.ledger.id + '&code=' + v.ledger.inviteCode,
    };
  },
});
