// 页面「冒烟测试」: 用假的 wx / Page / Component，把每个页面的 JS 真的跑一遍(本机体验模式)，
// 确认没有拼写错误、没有未定义变量，主要流程能走通。这不能代替在微信开发者工具里亲眼看一遍界面。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const store = {};
const calls = { navigateTo: [], navigateBack: 0, redirectTo: [], toast: [], modals: [], clipboard: [], switchTab: [], shared: [], titles: [] };
let modalAnswer = true;
let privacyListener = null;

function setPath(obj, p, v) {
  const parts = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = v;
}

global.wx = {
  getStorageSync: (k) => (k in store ? JSON.parse(JSON.stringify(store[k])) : ''),
  setStorageSync: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: (k) => { delete store[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(store) }),
  navigateTo: (o) => calls.navigateTo.push(o.url),
  navigateBack: () => { calls.navigateBack++; },
  redirectTo: (o) => calls.redirectTo.push(o.url),
  switchTab: (o) => calls.switchTab.push(o.url),
  showToast: (o) => calls.toast.push(o.title),
  showModal: (o) => { calls.modals.push(o.content); if (o.success) o.success({ confirm: modalAnswer }); },
  setClipboardData: (o) => { calls.clipboard.push(o.data); if (o.success) o.success(); },
  setNavigationBarTitle: (o) => calls.titles.push(o.title),
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({ writeFileSync: () => {}, readFileSync: () => global.__importText }),
  shareFileMessage: (o) => calls.shared.push(o.fileName),
  chooseMessageFile: (o) => o.success({ tempFiles: [{ path: '/tmp/x.json' }] }),
  onNeedPrivacyAuthorization: () => {},
  getPrivacySetting: (o) => o.success({ needAuthorization: true }),
  openPrivacyContract: (o) => o.fail && o.fail(),
};
const appObj = { globalData: { privacyResolve: null, privacyListeners: [], privacyAsked: false }, showPrivacy(s) { this.globalData.privacyListeners.forEach((f) => f(s)); } };
global.getApp = () => appObj;
global.App = () => {};

function loadPage(name) {
  let def = null;
  global.Page = (d) => { def = d; };
  const file = path.join(__dirname, '../miniprogram/pages', name, name + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, def);
  inst.data = JSON.parse(JSON.stringify(def.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => (k.indexOf('.') >= 0 || k.indexOf('[') >= 0 ? setPath(inst.data, k, patch[k]) : (inst.data[k] = patch[k])));
    if (cb) cb.call(inst);
  };
  return inst;
}
const tick = () => new Promise((r) => setImmediate(r));
const ev = (data, detail) => ({ currentTarget: { dataset: data || {} }, detail: detail || {} });

test('个人记账: 记一笔 → 首页出现 → 修改 → 删除', async () => {
  const rec = loadPage('record');
  rec.onLoad({});
  rec.setType(ev({ type: 'expense' }));
  rec.onAmount(ev({}, { value: '12.5' }));
  rec.setCategory(ev({ name: '交通' }));
  rec.onNote(ev({}, { value: '地铁' }));
  rec.save();
  assert.equal(calls.navigateBack, 1);

  const idx = loadPage('index');
  idx.onShow();
  assert.equal(idx.data.list.length, 1);
  assert.equal(idx.data.summary.expense, '12.50');
  assert.equal(idx.data.cats[0].name, '交通');
  assert.equal(idx.data.cats[0].percent, 100);

  const id = idx.data.list[0].id;
  const edit = loadPage('record');
  edit.onLoad({ id });
  assert.equal(edit.data.amountText, '12.5');
  edit.onAmount(ev({}, { value: '20' }));
  edit.save();
  idx.refresh();
  assert.equal(idx.data.summary.expense, '20.00');

  idx.prevMonth(); assert.equal(idx.data.list.length, 0);
  idx.nextMonth(); assert.equal(idx.data.list.length, 1);

  const bad = loadPage('record');
  bad.onLoad({});
  bad.onAmount(ev({}, { value: '1.234' }));
  bad.save();
  assert.match(bad.data.amountError, /两位小数/);
  assert.equal(bad.data.saving, false);

  const del = loadPage('record'); del.onLoad({ id }); del.remove(); await tick();
  idx.refresh();
  assert.equal(idx.data.list.length, 0);
});

test('共同账本(本机模式): 新建 → 加虚拟成员 → 记一笔 → 对账 → 标记已转 → 确认收到 → 结清', async () => {
  const ledgers = loadPage('ledgers');
  ledgers.onShow();
  assert.equal(ledgers.data.mode, 'local');
  ledgers.openCreate();
  ledgers.onName(ev({}, { value: '周末游' }));
  ledgers.onNickname(ev({}, { value: '小张' }));
  ledgers.create();
  await tick();
  const url = calls.navigateTo[calls.navigateTo.length - 1];
  assert.match(url, /^\/pages\/ledger\/ledger\?id=/);
  const lid = url.split('=')[1];
  ledgers.onShow(); await tick();
  assert.equal(ledgers.data.list.length, 1);

  const led = loadPage('ledger');
  led.onLoad({ id: lid }); led.onShow(); await tick();
  assert.equal(led.data.ready, true);
  led.onNewMember(ev({}, { value: '小红' })); led.addMember(); await tick();
  assert.deepEqual(led.data.members.map((m) => m.name), ['小张', '小红']);
  assert.equal(led.data.members[1].virtual, true);

  const exp = loadPage('expense');
  exp.onLoad({ lid }); await tick();
  assert.equal(exp.data.ready, true);
  exp.onTitle(ev({}, { value: '火锅' }));
  exp.onAmount(ev({}, { value: '100' }));
  assert.deepEqual(exp.data.preview.map((p) => p.shareText), ['50.00', '50.00']);
  exp.onAmount(ev({}, { value: '100.01' }));
  assert.deepEqual(exp.data.preview.map((p) => p.shareText), ['50.01', '50.00']);
  assert.equal(exp.data.hasRemainder, true);
  // 改成指定金额，故意不平
  exp.setMode(ev({ mode: 'custom' }));
  exp.onCustom(ev({ id: exp.data.preview[0].id }, { value: '60' }));
  exp.onCustom(ev({ id: exp.data.preview[1].id }, { value: '30' }));
  assert.equal(exp.data.customOk, false);
  assert.match(exp.data.customHint, /还差 10\.01/);
  exp.onCustom(ev({ id: exp.data.preview[1].id }, { value: '40.01' }));
  assert.equal(exp.data.customOk, true);
  const before = calls.navigateBack;
  exp.save(); await tick();
  assert.equal(calls.navigateBack, before + 1);
  exp.save(); // 保存中再点不会重复
  await tick();

  led.onShow(); await tick();
  assert.equal(led.data.items.length, 1);
  assert.equal(led.data.total, '100.01');
  assert.equal(led.data.statusText, '还有 1 笔要转账');

  // 修改这笔账
  const exp2 = loadPage('expense');
  exp2.onLoad({ lid, eid: led.data.items[0].id }); await tick();
  assert.equal(exp2.data.title, '火锅');
  assert.equal(exp2.data.splitMode, 'custom');
  exp2.setMode(ev({ mode: 'equal' }));
  exp2.save(); await tick();

  const st = loadPage('settle');
  st.onLoad({ id: lid }); st.onShow(); await tick();
  assert.equal(st.data.transfers.length, 1);
  assert.equal(st.data.transfers[0].fromName, '小红');
  assert.equal(st.data.transfers[0].amount, '50.00');
  assert.equal(st.data.transfers[0].canMarkPaid, true);
  assert.equal(st.data.people.length, 2);
  st.toggle(ev({ id: st.data.people[0].id }));
  assert.equal(st.data.people[0].open, true);
  st.copyText();
  assert.match(calls.clipboard[calls.clipboard.length - 1], /小红 → 小张 50\.00 元/);
  st.markPaid(ev({ index: 0 })); await tick();
  assert.equal(st.data.transfers[0].pending, true);
  assert.equal(st.data.transfers[0].canConfirm, true);
  st.confirm(ev({ id: st.data.transfers[0].pendingId })); await tick();
  assert.equal(st.data.settled, true);
  assert.equal(st.data.history[0].statusText, '已结清');
  assert.equal(st.data.history[0].canUndo, true);

  // 分享卡片: 本机模式不带邀请
  assert.equal(led.onShareAppMessage().path, '/pages/index/index');
  // 删除账本
  led.deleteLedger(); await tick();
  ledgers.onShow(); await tick();
  assert.equal(ledgers.data.list.length, 0);
});

test('加入页: 本机体验模式给出清楚的提示；缺参数时提示邀请不完整', async () => {
  const j = loadPage('join');
  j.onLoad({ lid: 'x', code: 'y' }); await tick();
  assert.equal(j.data.state, 'error');
  assert.match(j.data.message, /本机体验模式/);
  const j2 = loadPage('join');
  j2.onLoad({}); assert.equal(j2.data.state, 'error');
  assert.match(j2.data.message, /不完整/);
});

test('我的页: 导入网页版备份(预览→确认)、导出 CSV、清除全部数据', async () => {
  const idx = loadPage('index');
  const me = loadPage('me');
  me.onShow();
  global.__importText = JSON.stringify({ app: '绿宝记账', version: 1, records: [{ id: 'w1', type: 'expense', amount: 8.8, category: '餐饮', date: new Date().toISOString().slice(0, 7) + '-01', note: '早餐', createdAt: 1 }] });
  me.importWeb(); await tick(); await tick();
  assert.match(calls.modals.join('|'), /新的 1 笔/);
  assert.match(calls.modals[calls.modals.length - 1], /导入完成：新增 1 笔/);
  me.importWeb(); await tick(); await tick(); // 再导一次: 全部是重复
  assert.match(calls.modals.join('|'), /已经有的 1 笔/);
  assert.match(calls.modals[calls.modals.length - 1], /导入完成：新增 0 笔/);
  idx.onShow();
  assert.equal(idx.data.list.length, 1);
  me.exportCsv();
  assert.deepEqual(calls.shared, ['绿宝记账.csv']);
  me.clearAll(); await tick(); await tick();
  idx.onShow();
  assert.equal(idx.data.list.length, 0);
  global.__importText = 'not json';
  me.importWeb();
  assert.match(calls.modals[calls.modals.length - 1], /JSON/);
  const nick = loadPage('me'); nick.onShow(); nick.onNickname(ev({}, { value: '阿宝' })); nick.saveNickname();
  nick.onShow(); assert.equal(nick.data.nickname, '阿宝');
  me.backup(); await tick();
  assert.match(calls.modals[calls.modals.length - 1], /本机体验模式没有云备份/);
});

test('隐私页和隐私弹窗组件', () => {
  const p = loadPage('privacy'); p.onLoad();
  assert.ok(p.data.blocks.length > 10);
  assert.equal(p.data.blocks[0].type, 'h1');

  let def;
  global.Component = (d) => { def = d; };
  const file = path.join(__dirname, '../miniprogram/components/privacy-popup/privacy-popup.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const comp = Object.assign({ data: { show: false }, setData(o) { Object.assign(this.data, o); } }, def.methods);
  def.lifetimes.attached.call(comp);
  assert.equal(comp.data.show, true); // 首次打开: 还没同意 → 弹出
  let answer = null;
  appObj.globalData.privacyResolve = (r) => { answer = r; };
  comp.onAgree();
  assert.deepEqual(answer, { buttonId: 'agree-btn', event: 'agree' });
  assert.equal(comp.data.show, false);
  appObj.globalData.privacyResolve = (r) => { answer = r; };
  appObj.showPrivacy(true);
  assert.equal(comp.data.show, true);
  comp.onDisagree();
  assert.deepEqual(answer, { event: 'disagree' });
  def.lifetimes.detached.call(comp);
  assert.equal(appObj.globalData.privacyListeners.length, 0);
});
