// 把小程序里的隐私政策文本导出成 docs/隐私政策草稿.md（方便你复制到微信后台）。用法: npm run privacy
const fs = require('fs');
const path = require('path');
const { PRIVACY_TEXT } = require('../miniprogram/data/privacy');
fs.writeFileSync(path.join(__dirname, '../docs/隐私政策草稿.md'), PRIVACY_TEXT, 'utf8');
console.log('written docs/隐私政策草稿.md');
