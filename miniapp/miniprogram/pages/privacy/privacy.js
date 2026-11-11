const { PRIVACY_TEXT } = require('../../data/privacy');

Page({
  data: { blocks: [] },
  onLoad() {
    const blocks = PRIVACY_TEXT.split('\n').filter((l) => l.trim()).map((l, i) => {
      if (l.indexOf('# ') === 0) return { i, type: 'h1', text: l.slice(2) };
      if (l.indexOf('## ') === 0) return { i, type: 'h2', text: l.slice(3) };
      return { i, type: 'p', text: l };
    });
    this.setData({ blocks });
  },
});
