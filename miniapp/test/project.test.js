const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('云函数里的 lib 和 miniprogram/lib 是同一份（改了 lib 要运行 npm run sync）', () => {
  const plan = { 'cloudfunctions/ledger/lib': ['money.js', 'settle.js', 'ledgerCore.js'], 'cloudfunctions/personal/lib': ['money.js', 'records.js'] };
  Object.keys(plan).forEach((dir) => plan[dir].forEach((f) => assert.equal(read(dir + '/' + f), read('miniprogram/lib/' + f), dir + '/' + f)));
});

test('配置文件是合法 JSON，且使用游客 AppID，云环境默认留空', () => {
  const proj = JSON.parse(read('project.config.json'));
  assert.equal(proj.appid, 'touristappid');
  assert.equal(require('../miniprogram/config').CLOUD_ENV, '');
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.equal(app.__usePrivacyCheck__, true);
  app.pages.forEach((p) => ['js', 'wxml', 'wxss', 'json'].forEach((ext) => assert.ok(fs.existsSync(path.join(root, 'miniprogram', p + '.' + ext)), p + '.' + ext)));
  app.tabBar.list.forEach((t) => assert.ok(app.pages.includes(t.pagePath)));
  JSON.parse(read('miniprogram/sitemap.json'));
});

test('每个页面和组件的 json、引用的组件都存在', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  walk(path.join(root, 'miniprogram')).filter((f) => f.endsWith('.json')).forEach((f) => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    Object.keys(j.usingComponents || {}).forEach((k) => {
      const target = path.resolve(path.dirname(f), j.usingComponents[k]);
      assert.ok(fs.existsSync(target + '.js') || fs.existsSync(path.join(root, 'miniprogram', j.usingComponents[k] + '.js')), f + ' -> ' + k);
    });
  });
});

test('WXML 标签配对正确，没有在 wxml 里调用函数', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(path.join(root, 'miniprogram')).filter((f) => f.endsWith('.wxml'));
  assert.ok(files.length >= 10);
  const voidTags = new Set(['input', 'image', 'import', 'include', 'progress', 'icon', 'checkbox', 'radio', 'slider', 'switch', 'textarea', 'map', 'canvas']);
  files.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;
    let m;
    while ((m = re.exec(src))) {
      const [, close, tag, , selfClose] = m;
      if (selfClose || (voidTags.has(tag) && !close)) continue;
      if (!close) stack.push(tag);
      else assert.equal(stack.pop(), tag, f + ' 标签不配对: ' + tag);
    }
    assert.deepEqual(stack, [], f + ' 有标签没关闭');
    (src.match(/\{\{[^}]*\}\}/g) || []).forEach((e) => assert.ok(!/[A-Za-z_]\w*\s*\(/.test(e), f + ' wxml 里不能调用函数: ' + e));
  });
});

test('所有 JS 语法正确，且不使用旧版小程序不支持的写法(?. ??)', () => {
  const { execFileSync } = require('child_process');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  walk(path.join(root, 'miniprogram')).filter((f) => f.endsWith('.js')).forEach((f) => {
    execFileSync(process.execPath, ['--check', f]);
    assert.ok(!/\?\.[A-Za-z_(\[]|\?\?/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')), f);
  });
});

test('隐私政策文本: 小程序里的和 docs 里的是同一份，且包含必需的说明', () => {
  const t = require('../miniprogram/data/privacy').PRIVACY_TEXT;
  assert.equal(read('docs/隐私政策草稿.md').trim(), t.trim());
  ['收集', '用途', '保存', '删除', '联系', '昵称', 'OPENID', '不收集', '不提供支付'].forEach((k) => assert.ok(t.includes(k), k));
});
