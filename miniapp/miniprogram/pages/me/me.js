const api = require('../../services/api');
const profile = require('../../services/profile');
const personal = require('../../services/personalStore');
const records = require('../../lib/records');
const config = require('../../config');
const ui = require('../../utils/ui');

Page({
  data: { nickname: '', mode: '', version: config.VERSION },

  onShow() { this.setData({ nickname: profile.getNickname(), mode: api.mode() }); },

  onNickname(e) { this.setData({ nickname: e.detail.value }); },
  saveNickname() { profile.setNickname(this.data.nickname); ui.toast('已保存'); },

  openPolicy() { wx.navigateTo({ url: '/pages/privacy/privacy' }); },
  openContract() {
    if (wx.openPrivacyContract) wx.openPrivacyContract({ fail: () => ui.alert('微信隐私保护指引要在小程序后台配置后才能打开。现在可以先看「查看隐私政策」。') });
  },

  // 读网页版导出的 JSON 备份，先预览，确认后才导入
  importWeb() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: (res) => {
        let text;
        try { text = wx.getFileSystemManager().readFileSync(res.tempFiles[0].path, 'utf8'); } catch (e) { ui.alert('读不了这个文件，请换一个再试。'); return; }
        const parsed = records.parseWebBackup(text);
        if (parsed.error) { ui.alert(parsed.error); return; }
        const existing = personal.load().records;
        const have = {};
        existing.forEach((r) => { have[r.id] = true; });
        const dup = parsed.records.filter((r) => have[r.id]).length;
        const fresh = parsed.records.length - dup;
        ui.confirm('导入预览', '文件里有 ' + parsed.records.length + ' 笔账：新的 ' + fresh + ' 笔，已经有的 ' + dup + ' 笔（会跳过）' + (parsed.skipped ? '，看不懂的 ' + parsed.skipped + ' 条（会跳过）' : '') + '。要导入吗？', '导入').then((ok) => {
          if (!ok) return;
          try {
            const r = personal.mergeIn(parsed.records);
            ui.alert('导入完成：新增 ' + r.added + ' 笔' + (r.overLimit ? '，超出上限 ' + r.overLimit + ' 笔没有导入' : '') + '。');
          } catch (e) { ui.showError(e); }
        });
      },
      fail: () => {},
    });
  },

  exportCsv() {
    const list = personal.load().records;
    if (!list.length) { ui.toast('还没有账目可以导出'); return; }
    const csv = records.toCsv(list);
    const path = wx.env.USER_DATA_PATH + '/lvbao-jizhang.csv';
    try {
      wx.getFileSystemManager().writeFileSync(path, csv, 'utf8');
      if (wx.shareFileMessage) {
        wx.shareFileMessage({ filePath: path, fileName: '绿宝记账.csv', fail: () => this.copyCsv(csv) });
        return;
      }
    } catch (e) { /* 写文件失败就退回复制 */ }
    this.copyCsv(csv);
  },
  copyCsv(csv) {
    wx.setClipboardData({ data: csv.replace(/^\uFEFF/, ''), success: () => ui.alert('没法直接发文件，已经把表格内容复制好了，你可以粘贴到备忘录或表格里。') });
  },

  backup() {
    const list = personal.load().records;
    ui.confirm('备份到云端？', '会上传你的个人账目（' + list.length + ' 笔）到云端，并覆盖之前的云备份。', '备份').then((ok) => {
      if (!ok) return null;
      return api.personal('pushBackup', { records: list }).then((r) => ui.alert('备份完成：' + r.count + ' 笔。'));
    }).catch(ui.showError);
  },
  restore() {
    api.personal('pullBackup', {}).then((r) => {
      if (!r.records.length) { ui.alert('云端还没有备份。'); return null; }
      const parsed = records.parseWebBackup(JSON.stringify(r.records));
      const res = personal.mergeIn(parsed.records);
      ui.alert('恢复完成：新增 ' + res.added + ' 笔，已有的 ' + res.duplicate + ' 笔没有动。');
      return null;
    }).catch(ui.showError);
  },

  clearAll() {
    ui.confirm('清除全部数据？', '会清空这台手机上的所有账目、昵称和共同账本；云端模式下还会删除云备份，并把你从共同账本里匿名移除。不能恢复。', '继续', true).then((ok) => {
      if (!ok) return null;
      return ui.confirm('再确认一次', '真的要清除吗？建议先导出一份留着。', '清除', true);
    }).then((ok) => {
      if (!ok) return null;
      const tasks = [api.call('deleteMyData', {})];
      if (api.mode() === 'cloud') tasks.push(api.personal('deleteBackup', {}));
      return Promise.all(tasks).then(() => {
        personal.clearAll();
        profile.clear();
        this.setData({ nickname: '' });
        ui.alert('已清除。');
      });
    }).catch(ui.showError);
  },
});
