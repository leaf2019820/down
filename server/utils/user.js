const fs = require('fs-extra');
const path = require('path');
const bcrypt = require('bcryptjs');

// 用户数据文件路径
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

// 确保用户数据文件存在
if (!fs.existsSync(USERS_FILE)) {
  fs.writeJSONSync(USERS_FILE, { users: [] });
}

// 获取所有用户
async function getUsers() {
  try {
    const data = await fs.readJSON(USERS_FILE);
    if (!data || !Array.isArray(data.users)) {
      console.error('用户数据格式错误，重置为空数组');
      await saveUsers([]);
      return [];
    }
    return data.users;
  } catch (error) {
    console.error('读取用户数据失败:', error);
    return [];
  }
}

// 保存所有用户
async function saveUsers(users) {
  try {
    await fs.writeJSON(USERS_FILE, { users });
  } catch (error) {
    console.error('保存用户数据失败:', error);
    throw error;
  }
}

// 根据邮箱查找用户
async function getUserByEmail(email) {
  const users = await getUsers();
  return users.find(user => user.email === email);
}

// 根据ID查找用户
async function getUserById(id) {
  const users = await getUsers();
  return users.find(user => user.id === id);
}

// 创建新用户
async function createUser(userData) {
  const users = await getUsers();
  
  // 检查邮箱是否已存在
  if (users.some(user => user.email === userData.email)) {
    throw new Error('邮箱已被注册');
  }
  
  // 生成用户ID
  const id = Date.now().toString();
  
  // 加密密码
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(userData.password, salt);
  
  // 创建用户对象
  const user = {
    id,
    email: userData.email,
    password: hashedPassword,
    createdAt: new Date().toISOString()
  };
  
  // 添加到用户列表
  users.push(user);
  
  // 保存用户数据
  await saveUsers(users);
  
  return user;
}

// 验证用户密码
async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password);
}

module.exports = {
  getUsers,
  getUserByEmail,
  getUserById,
  createUser,
  verifyPassword
}; 