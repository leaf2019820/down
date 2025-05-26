const nodemailer = require('nodemailer');

// 创建邮件传输对象
const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true, // 使用SSL
  auth: {
    user: process.env.EMAIL_USER,     // QQ邮箱
    pass: process.env.EMAIL_PASSWORD  // QQ邮箱授权码
  }
});

// 测试邮件配置
async function testEmailConfig() {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: '文件下载器 - 邮箱配置测试',
      text: '如果你收到这封邮件，说明邮箱配置成功！'
    });
    console.log('邮箱配置测试成功！');
    return true;
  } catch (error) {
    console.error('邮箱配置测试失败:', error);
    return false;
  }
}

// 发送验证邮件
async function sendVerificationEmail(email, token) {
  const verificationUrl = `${process.env.BASE_URL}/verify?token=${token}`;
  
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: '文件下载器 - 邮箱验证',
    html: `
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h2 style="color: #333;">欢迎使用文件下载器</h2>
        <p>请点击下面的按钮验证您的邮箱：</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px;">
            验证邮箱
          </a>
        </div>
        <p>如果按钮无法点击，您也可以复制以下链接到浏览器地址栏：</p>
        <p style="word-break: break-all;">${verificationUrl}</p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          此邮件由系统自动发送，请勿回复。
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('发送邮件失败:', error);
    return false;
  }
}

module.exports = {
  sendVerificationEmail,
  testEmailConfig
}; 