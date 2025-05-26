const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs-extra');

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'database.sqlite');

// 确保数据库目录存在
fs.ensureDirSync(path.dirname(dbPath));

// 创建 Sequelize 实例
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false // 关闭 SQL 查询日志
});

// 测试数据库连接
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('数据库连接成功');
  } catch (error) {
    console.error('数据库连接失败:', error);
    throw error;
  }
}

// 同步数据库模型
async function syncDatabase() {
  try {
    await sequelize.sync();
    console.log('数据库同步完成');
  } catch (error) {
    console.error('数据库同步失败:', error);
    throw error;
  }
}

// 初始化数据库
async function initDatabase() {
  await testConnection();
  await syncDatabase();
}

module.exports = {
  sequelize,
  initDatabase
}; 