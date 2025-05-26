const nodemailer = require('nodemailer');
const fs = require('fs-extra');
const path = require('path');

// 验证码存储文件路径
const CODES_FILE = path.join(__dirname, '..', 'data', 'verification_codes.json');

// 确保验证码文件存在
if (!fs.existsSync(CODES_FILE)) {
  fs.writeJSONSync(CODES_FILE, {});
}

// 创建邮件传输器
const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// 生成6位数字验证码
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 保存验证码
async function saveCode(email, code) {
  const codes = await fs.readJSON(CODES_FILE);
  codes[email] = {
    code,
    timestamp: Date.now()
  };
  await fs.writeJSON(CODES_FILE, codes);
}

// 验证验证码
async function verifyCode(email, code) {
  try {
    const codes = await fs.readJSON(CODES_FILE);
    const record = codes[email];
    
    if (!record) {
      return { success: false, message: '验证码不存在' };
    }
    
    // 验证码5分钟有效
    if (Date.now() - record.timestamp > 5 * 60 * 1000) {
      delete codes[email];
      await fs.writeJSON(CODES_FILE, codes);
      return { success: false, message: '验证码已过期' };
    }
    
    if (record.code !== code) {
      return { success: false, message: '验证码错误' };
    }
    
    // 验证成功后删除验证码
    delete codes[email];
    await fs.writeJSON(CODES_FILE, codes);
    
    return { success: true, message: '验证成功' };
  } catch (error) {
    console.error('验证码验证失败:', error);
    return { success: false, message: '验证失败' };
  }
}

// 检查是否可以发送验证码
async function canSendCode(email) {
  try {
    const codes = await fs.readJSON(CODES_FILE);
    const record = codes[email];
    
    if (!record) {
      return true;
    }
    
    // 1分钟内不能重复发送
    if (Date.now() - record.timestamp < 60 * 1000) {
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('检查验证码发送状态失败:', error);
    return false;
  }
}

// 发送验证码
async function sendVerificationCode(email) {
  try {
    // 检查是否可以发送
    const canSend = await canSendCode(email);
    if (!canSend) {
      return { success: false, message: '请稍后再试' };
    }
    
    // 生成验证码
    const code = generateCode();
    
    // 保存验证码
    await saveCode(email, code);
    
    // 发送邮件
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: '文件下载器 - 验证码',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">验证码</h2>
          <p style="color: #666;">您的验证码是：</p>
          <div style="background-color: #f5f5f5; padding: 10px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0;">
            <strong>${code}</strong>
          </div>
          <p style="color: #666;">验证码有效期为5分钟，请尽快使用。</p>
          <p style="color: #999; font-size: 12px;">如果这不是您的操作，请忽略此邮件。</p>
        </div>
      `
    });
    
    return { success: true, message: '验证码已发送' };
  } catch (error) {
    console.error('发送验证码失败:', error);
    return { success: false, message: '发送失败，请稍后重试' };
  }
}

module.exports = {
  sendVerificationCode,
  verifyCode,
  canSendCode
}; 