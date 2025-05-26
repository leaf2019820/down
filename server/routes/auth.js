const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { sendVerificationCode, verifyCode } = require('../utils/email');
const User = require('../models/User');
const path = require('path');
const fs = require('fs-extra');

// 用户目录路径
const USER_DIR = path.join(__dirname, '..', 'data', 'users');

// 确保用户目录存在
fs.ensureDirSync(USER_DIR);

// 创建用户目录
function createUserDir(username) {
  const userDir = path.join(USER_DIR, username);
  fs.ensureDirSync(userDir);
  // 创建用户历史记录文件
  fs.writeJSONSync(path.join(userDir, 'history.json'), []);
}

// 发送验证码
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    
    // 验证邮箱格式
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }

    // 检查邮箱是否已注册
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: '该邮箱已注册' });
    }

    // 发送验证码
    const result = await sendVerificationCode(email);
    if (result.success) {
      res.json({ message: result.message });
    } else {
      res.status(400).json({ error: result.message });
    }
  } catch (error) {
    console.error('发送验证码错误:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { email, code, password } = req.body;
    
    // 验证邮箱格式
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    
    // 验证密码格式
    if (!password || password.length < 6 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: '密码必须至少6位，且包含字母和数字' });
    }
    
    // 验证验证码
    const verifyResult = await verifyCode(email, code);
    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.message });
    }
    
    // 检查邮箱是否已注册
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: '该邮箱已注册' });
    }
    
    // 生成用户名（使用邮箱前缀）
    const username = email.split('@')[0];
    
    // 创建用户目录
    createUserDir(username);
    
    // 创建新用户
    const user = await User.create({
      email,
      password
    });
    
    res.json({ message: '注册成功' });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ error: error.message || '注册失败' });
  }
});

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // 查找用户
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    
    // 验证密码
    const isValid = await user.verifyPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: '密码错误' });
    }
    
    // 生成JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('登录失败:', error);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 检查登录状态
router.get('/check', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '未登录' });
    }

    // 从数据库获取最新的用户信息
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email
      }
    });
  } catch (error) {
    console.error('检查登录状态失败:', error);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取历史记录
router.get('/history', async (req, res) => {
  try {
    let history = [];
    
    if (req.user) {
      // 已登录用户：获取用户特定的历史记录
      const userDir = path.join(USER_DIR, req.user.email.split('@')[0]);
      const historyFile = path.join(userDir, 'history.json');
      
      if (await fs.pathExists(historyFile)) {
        history = await fs.readJSON(historyFile);
      }
      console.log('获取用户历史记录:', {
        user: req.user.email,
        historyCount: history.length
      });
    } else {
      // 未登录用户：获取公共历史记录
      const publicHistoryFile = path.join(__dirname, '..', 'data', 'history.json');
      if (await fs.pathExists(publicHistoryFile)) {
        history = await fs.readJSON(publicHistoryFile);
      }
      console.log('获取公共历史记录:', {
        historyCount: history.length
      });
    }
    
    // 确保返回的是数组
    if (!Array.isArray(history)) {
      history = [];
    }
    
    res.json(history);
  } catch (error) {
    console.error('获取历史记录失败:', error);
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

module.exports = router; 