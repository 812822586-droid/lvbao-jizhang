const api = require('../../services/api');
const money = require('../../lib/money');
const records = require('../../lib/records');
const ui = require('../../utils/ui');
const ids = require('../../services/ids');

Page({
  data: {
    ready: false, error: '', eid: '', canEdit: true, quick: ['餐饮', '住宿', '交通', '门票', '购物', '其他'],
    title: '', amountText: '', amountError: '', payerId: '', splitMode: 'equal', members: [], preview: [], hasRemainder: false,
    customOk: true, customHint: '', date: '', note: '', saving: false,
  },

  onLoad(options) {
    this.ledgerId = options.lid;
    this.expenseId = options.eid || '';
    this.clientId = ids.genId(); // 防止连点保存记两遍
    this.customMap = {};
    api.call('getLedger', { ledgerId: this.ledgerId }).then((r) => this.init(r.view)).catch((e) => {
      this.setData({ error: e.message || '打不开' });
      ui.showError(e);
    });
  },

  init(v) {
    this.view = v;
    const active = v.members.filter((m) => !m.left);
    let data = { ready: true, eid: this.expenseId, date: records.todayStr(), payerId: v.me ? v.me.memberId : (active[0] && active[0].id) };
    let selected = {};
    let list = active;
    if (this.expenseId) {
      const e = v.expenses.find((x) => x.id === this.expenseId);
      if (!e || e.deletedAt) { this.setData({ error: '找不到这笔账' }); return; }
      this.rev = e.rev;
      // 已退出的人如果在老账里，也要显示出来，否则改账时会丢掉他的份额
      list = v.members.filter((m) => !m.left || e.participantIds.indexOf(m.id) >= 0 || e.payerId === m.id);
      e.participantIds.forEach((id) => { selected[id] = true; });
      Object.keys(e.shares).forEach((id) => { this.customMap[id] = money.centsToInput(e.shares[id]); });
      data = Object.assign(data, { title: e.title, amountText: money.centsToInput(e.amountCents), payerId: e.payerId, splitMode: e.splitMode, date: e.date, note: e.note, canEdit: e.canEdit });
      wx.setNavigationBarTitle({ title: '修改这笔账' });
    } else {
      list.forEach((m) => { selected[m.id] = true; });
    }
    data.members = list.map((m) => ({ id: m.id, name: m.name + (m.left ? '（已退出）' : ''), selected: !!selected[m.id] }));
    this.setData(data, () => this.recalc());
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  pickQuick(e) { this.setData({ title: e.currentTarget.dataset.t }); },
  onAmount(e) { this.setData({ amountText: e.detail.value, amountError: '' }, () => this.recalc()); },
  pickPayer(e) { this.setData({ payerId: e.currentTarget.dataset.id }); },
  toggleMember(e) {
    const i = e.currentTarget.dataset.index;
    this.setData({ ['members[' + i + '].selected']: !this.data.members[i].selected }, () => this.recalc());
  },
  selectAll() {
    this.setData({ members: this.data.members.map((m) => Object.assign({}, m, { selected: true })) }, () => this.recalc());
  },
  setMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.splitMode) return;
    this.setData({ splitMode: mode }, () => this.recalc());
  },
  onCustom(e) {
    this.customMap[e.currentTarget.dataset.id] = e.detail.value;
    this.recalc(true);
  },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  // 重新算「每人出多少」。keepInputs=true 时不重写输入框，避免打字时光标跳动。
  recalc(keepInputs) {
    const total = money.parseYuan(this.data.amountText);
    const sel = this.data.members.filter((m) => m.selected);
    const preview = sel.map((m) => ({ id: m.id, name: m.name, shareText: '', customText: this.customMap[m.id] || '' }));
    let hasRemainder = false;
    let customOk = true;
    let customHint = '';
    if (this.data.splitMode === 'equal') {
      if (total.ok && sel.length) {
        const parts = money.splitEqual(total.cents, sel.length);
        preview.forEach((p, i) => { p.shareText = money.formatCents(parts[i]); });
        hasRemainder = total.cents % sel.length !== 0;
      } else preview.forEach((p) => { p.shareText = '—'; });
    } else {
      let sum = 0;
      let bad = false;
      preview.forEach((p) => {
        const r = money.parseYuan(p.customText);
        if (r.ok) sum += r.cents; else bad = true;
      });
      if (!total.ok) { customOk = false; customHint = '先填上面的总金额'; }
      else if (bad) { customOk = false; customHint = '每个参与的人都要填一个大于 0 的金额'; }
      else if (sum !== total.cents) {
        customOk = false;
        const diff = total.cents - sum;
        customHint = '已分配 ' + money.formatCents(sum) + ' 元，' + (diff > 0 ? '还差 ' : '多了 ') + money.formatCents(Math.abs(diff)) + ' 元';
      } else customHint = '合计 ' + money.formatCents(sum) + ' 元，正好';
    }
    const patch = { hasRemainder, customOk, customHint };
    if (!keepInputs) patch.preview = preview; else patch.preview = this.data.preview.length === preview.length ? this.data.preview.map((p) => Object.assign({}, p, { customText: this.customMap[p.id] || '' })) : preview;
    this.setData(patch);
  },

  save() {
    if (this.data.saving) return;
    const total = money.parseYuan(this.data.amountText);
    if (!this.data.title.trim()) { ui.toast('请写清花在什么上'); return; }
    if (!total.ok) { this.setData({ amountError: money.amountErrorText(total.reason) }); return; }
    const sel = this.data.members.filter((m) => m.selected);
    if (!sel.length) { ui.toast('至少选一个参与分摊的人'); return; }
    const params = {
      ledgerId: this.ledgerId, title: this.data.title, amountCents: total.cents, payerId: this.data.payerId,
      splitMode: this.data.splitMode, participantIds: sel.map((m) => m.id), date: this.data.date, note: this.data.note,
    };
    if (this.data.splitMode === 'custom') {
      if (!this.data.customOk) { ui.toast(this.data.customHint); return; }
      params.customShares = {};
      sel.forEach((m) => { params.customShares[m.id] = money.parseYuan(this.customMap[m.id]).cents; });
    }
    this.setData({ saving: true });
    let p;
    if (this.expenseId) { params.expenseId = this.expenseId; params.rev = this.rev; p = api.call('updateExpense', params); }
    else { params.clientId = this.clientId; p = api.call('addExpense', params); }
    p.then(() => wx.navigateBack()).catch((e) => { this.setData({ saving: false }); ui.showError(e); });
  },

  remove() {
    ui.confirm('删除这笔账？', '删除后可以在账本页「已删除的账目」里恢复。', '删除', true).then((ok) => {
      if (!ok) return null;
      return api.call('deleteExpense', { ledgerId: this.ledgerId, expenseId: this.expenseId }).then(() => wx.navigateBack());
    }).catch(ui.showError);
  },
});
