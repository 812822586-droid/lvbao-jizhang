// 云函数入口: 共同账本。部署方法见 README「第四步」。
const cloud = require('wx-server-sdk');
const { handle } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext(); // 微信给每个用户在本小程序里的唯一编号，不是手机号也不是微信号
  return handle(cloud.database(), event, OPENID);
};
