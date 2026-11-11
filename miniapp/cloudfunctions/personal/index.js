// 云函数入口: 个人账本云备份。
const cloud = require('wx-server-sdk');
const { handle } = require('./handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  return handle(cloud.database(), event, OPENID);
};
