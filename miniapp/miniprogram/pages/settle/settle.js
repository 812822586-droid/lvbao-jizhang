const api = require('../../services/api');
const money = require('../../lib/money');
const ui = require('../../utils/ui');
const ids = require('../../services/ids');

const STATUS = { paid: ['等待确认', 'warn'], confirmed: ['已结清', ''], cancelled: ['已撤销', 'gray'] };

Page({
  data: { ready: false, error: '', settled: false, changedAfterSettle: false, transfers: [], people: [], history: [] },

  onLoad(options) {
    this.ledgerId = options.id;
    this.open = {};
  },
  onShow() {
    api.call('getLedger', { ledgerId: this.ledgerId }).then((r) => this.render(r.view)).catch((e) => { this.setData({ error: e.message }); ui.showError(e); });
  },

  render(v) {
    this.view = v;
    const name = {};
    v.members.forEach((m) => { name[m.id] = m.name; });
    const payById = {};
    v.payments.forEach((p) => { payById[p.id] = p; });
    this.markClientIds = this.markClientIds || {};
    const transfers = v.transfers.map((t, index) => {
      const pay = t.pendingPaymentId ? payById[t.pendingPaymentId] : null;
      return {
        key: t.fromId + '>' + t.toId, index, fromId: t.fromId, toId: t.toId, amountCents: t.amountCents,
        fromName: name[t.fromId], toName: name[t.toId], amount: money.formatCents(t.amountCents),
        pending: !!pay, pendingId: pay ? pay.id : '',
        canMarkPaid: t.canMarkPaid, canConfirm: !!(pay && pay.canConfirm), canCancel: !!(pay && pay.canCancel),
        cancelText: pay && pay.canConfirm ? '没收到（驳回）' : '撤回',
      };
    });
    const people = v.members.filter((m) => !m.left || v.balances[m.id] !== 0).map((m) => {
      const b = v.breakdowns[m.id];
      const net = v.balances[m.id];
      let settledText = '';
      if (b.settledOut || b.settledIn) settledText = '已确认转出 ' + money.formatCents(b.settledOut) + ' 元、收到 ' + money.formatCents(b.settledIn) + ' 元';
      return {
        id: m.id, name: m.name + (m.isMe ? '（我）' : ''), open: !!this.open[m.id],
        netText: (net > 0 ? '+' : '') + money.formatCents(net), cls: net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero',
        paidTotal: money.formatCents(b.paidTotal), owedTotal: money.formatCents(b.owedTotal), settledText,
        paid: b.paid.map((p) => ({ expenseId: p.expenseId, title: p.title, amount: money.formatCents(p.amountCents) })),
        owed: b.owed.map((o) => ({ expenseId: o.expenseId, title: o.title, amount: money.formatCents(o.shareCents) })),
      };
    });
    const history = v.payments.map((p) => ({
      id: p.id, fromName: name[p.fromId], toName: name[p.toId], amount: money.formatCents(p.amountCents),
      statusText: STATUS[p.status][0], tagClass: STATUS[p.status][1], canUndo: p.status === 'confirmed' && p.canCancel,
    }));
    this.setData({ ready: true, error: '', settled: v.settled, changedAfterSettle: v.changedAfterSettle, transfers, people, history });
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    this.open[id] = !this.open[id];
    this.setData({ people: this.data.people.map((p) => Object.assign({}, p, { open: !!this.open[p.id] })) });
  },

  markPaid(e) {
    const t = this.data.transfers[e.currentTarget.dataset.index];
    ui.confirm('确认已经转账？', t.fromName + ' 已经用微信转给 ' + t.toName + ' ' + t.amount + ' 元。绿宝只是记一笔，不会真的转钱。', '我已转账').then((ok) => {
      if (!ok) return null;
      const key = t.key + ':' + t.amountCents;
      this.markClientIds[key] = this.markClientIds[key] || ids.genId(); // 连点不会标记两次
      return api.call('markPaid', { ledgerId: this.ledgerId, fromId: t.fromId, toId: t.toId, amountCents: t.amountCents, clientId: this.markClientIds[key] }).then((r) => this.render(r.view));
    }).catch(ui.showError);
  },

  confirm(e) {
    ui.confirm('确认钱已经收到？', '确认后这一笔就算结清了。请先看一眼微信里是不是真的收到了。', '确认收到').then((ok) => {
      if (!ok) return null;
      return api.call('confirmPayment', { ledgerId: this.ledgerId, paymentId: e.currentTarget.dataset.id }).then((r) => this.render(r.view));
    }).catch(ui.showError);
  },

  cancel(e) {
    const undo = !!e.currentTarget.dataset.confirmed;
    ui.confirm(undo ? '撤销这笔收款确认？' : '撤回这条转账记录？', undo ? '撤销后这笔钱会重新变成「还没结清」。' : '记录会变成「已撤销」，需要的话可以重新标记。', undo ? '撤销' : '确定', true).then((ok) => {
      if (!ok) return null;
      return api.call('cancelPayment', { ledgerId: this.ledgerId, paymentId: e.currentTarget.dataset.id }).then((r) => this.render(r.view));
    }).catch(ui.showError);
  },

  copyText() {
    const lines = this.data.transfers.map((t) => t.fromName + ' → ' + t.toName + ' ' + t.amount + ' 元');
    wx.setClipboardData({ data: '【' + this.view.ledger.name + '】对账结果\n' + lines.join('\n') + '\n（用绿宝记账算的）' });
  },
});
