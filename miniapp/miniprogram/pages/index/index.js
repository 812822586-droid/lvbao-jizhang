const personal = require('../../services/personalStore');
const records = require('../../lib/records');
const money = require('../../lib/money');

Page({
  data: { month: '', monthLabel: '', summary: { income: '0.00', expense: '0.00', balance: '0.00', balanceClass: 'zero' }, cats: [], list: [], notice: '' },

  onShow() {
    if (!this.data.month) this.setData({ month: records.monthOf(records.todayStr()) });
    this.refresh();
  },

  refresh() {
    const { records: all, notice } = personal.load();
    const month = this.data.month;
    const s = records.monthSummary(all, month);
    const list = records.inMonth(all, month).map((r) => ({
      id: r.id, category: r.category, date: r.date, note: r.note, color: records.categoryColor(r.category),
      sign: r.type === 'income' ? '+' : '-', cls: r.type === 'income' ? 'pos' : 'neg', amount: money.formatCents(r.amountCents),
    }));
    const cats = records.categoryBreakdown(all, month).map((c) => ({ name: c.name, amount: money.formatCents(c.cents), percent: c.percent, color: c.color }));
    this.setData({
      notice, monthLabel: records.monthLabel(month), list, cats,
      summary: {
        income: money.formatCents(s.incomeCents), expense: money.formatCents(s.expenseCents), balance: money.formatCents(s.balanceCents),
        balanceClass: s.balanceCents > 0 ? 'pos' : s.balanceCents < 0 ? 'neg' : 'zero',
      },
    });
  },

  prevMonth() { this.setData({ month: records.shiftMonth(this.data.month, -1) }, () => this.refresh()); },
  nextMonth() { this.setData({ month: records.shiftMonth(this.data.month, 1) }, () => this.refresh()); },
  addRecord() { wx.navigateTo({ url: '/pages/record/record' }); },
  editRecord(e) { wx.navigateTo({ url: '/pages/record/record?id=' + e.currentTarget.dataset.id }); },
});
