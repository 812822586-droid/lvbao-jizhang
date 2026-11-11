// 把 miniprogram/lib 里「云函数也要用」的文件复制到云函数目录（云函数是单独打包上传的，不能引用外面的文件）。
// 用法: npm run sync
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const plan = {
  'cloudfunctions/ledger/lib': ['money.js', 'settle.js', 'ledgerCore.js'],
  'cloudfunctions/personal/lib': ['money.js', 'records.js'],
};
Object.keys(plan).forEach((dir) => {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  plan[dir].forEach((f) => {
    fs.copyFileSync(path.join(root, 'miniprogram/lib', f), path.join(root, dir, f));
    console.log('copied', f, '->', dir);
  });
});
