const personal = require('../../services/personalStore');
const records = require('../../lib/records');
const money = require('../../lib/money');
const ui = require('../../utils/ui');

Page({
  data: {
    id: '', type: 'expense', amountText: '', amountError: '', category: '餐饮', categories: records.EXPENSE_CATEGORIES,
    date: '', note: '', saving: false,
  },

  onLoad(options) {
    const today = records.todayStr();
    if (options.id) {
      const r = personal.get(options.id);
      if (!r) { ui.toast('找不到这笔账'); setTimeout(() => wx.navigateBack(), 800); return; }
      this.setData({
        id: r.id, type: r.type, amountText: money.centsToInput(r.amountCents), category: r.category, date: r.date, note: r.note,
        categories: this.catsFor(r.type, r.category),
      });
      wx.setNavigationBarTitle({ title: '修改这笔账' });
    } else {
      this.setData({ date: today });
    }
  },

  // 编辑老账时，如果它的分类不在常用列表里(例如网页版导入的)，也要显示出来
  catsFor(type, current) {
    const base = type === 'income' ? records.INCOME_CATEGORIES : records.EXPENSE_CATEGORIES;
    return base.indexOf(current) >= 0 ? base : base.concat([current]);
  },

  setType(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.type) return;
    const category = type === 'income' ? '工资' : '餐饮';
    this.setData({ type, category, categories: this.catsFor(type, category) });
  },
  setCategory(e) { this.setData({ category: e.currentTarget.dataset.name }); },
  onAmount(e) { this.setData({ amountText: e.detail.value, amountError: '' }); },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  save() {
    if (this.data.saving) return; // 防止连点保存两次
    const r = money.parseYuan(this.data.amountText);
    if (!r.ok) { this.setData({ amountError: money.amountErrorText(r.reason) }); return; }
    this.setData({ saving: true });
    const input = { type: this.data.type, amountCents: r.cents, category: this.data.category, date: this.data.date, note: this.data.note };
    try {
      if (this.data.id) personal.update(this.data.id, input); else personal.add(input);
      wx.navigateBack();
    } catch (e) {
      this.setData({ saving: false });
      ui.showError(e);
    }
  },

  remove() {
    ui.confirm('删除这笔账？', '删除后不能恢复。', '删除', true).then((ok) => {
      if (!ok) return;
      try { personal.remove(this.data.id); wx.navigateBack(); } catch (e) { ui.showError(e); }
    });
  },
});
