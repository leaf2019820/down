// 用户状态管理
const auth = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user')),
  
  // 检查是否已登录
  isLoggedIn() {
    return !!this.token;
  },
  
  // 更新界面显示
  updateUI() {
    const authButtons = document.getElementById('authButtons');
    const userInfo = document.getElementById('userInfo');
    const username = document.getElementById('username');
    
    if (this.isLoggedIn()) {
      authButtons.classList.add('d-none');
      userInfo.classList.remove('d-none');
      username.textContent = this.user.username;
    } else {
      authButtons.classList.remove('d-none');
      userInfo.classList.add('d-none');
    }
  },
  
  // 登出
  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.updateUI();
    window.location.href = '/';
  }
};

// 页面加载时检查登录状态
document.addEventListener('DOMContentLoaded', () => {
  auth.updateUI();
  
  // 绑定登出按钮
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      auth.logout();
    });
  }
});

// 验证码倒计时
let codeTimer = null;
let countdown = 60;

function startCodeCountdown() {
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;
    
    btn.disabled = true;
    countdown = 60;
    updateCodeButton();
    
    if (codeTimer) {
        clearInterval(codeTimer);
    }
    
    codeTimer = setInterval(() => {
        countdown--;
        updateCodeButton();
        
        if (countdown <= 0) {
            clearInterval(codeTimer);
            resetCodeButton();
        }
    }, 1000);
}

function updateCodeButton() {
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;
    btn.innerHTML = `<i class="fas fa-clock me-1"></i>${countdown}秒后重试`;
}

function resetCodeButton() {
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane me-1"></i>获取验证码';
}

// 发送验证码
async function sendVerificationCode(email) {
    const btn = document.getElementById('sendCodeBtn');
    if (!btn) return;
    
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>发送中...';
        
        const response = await fetch('http://localhost:3000/api/auth/send-code', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await response.json();
        
        if (response.ok) {
            showToast('success', '验证码已发送到您的邮箱');
            startCodeCountdown();
        } else {
            showToast('error', data.error || '发送验证码失败');
            resetCodeButton();
        }
    } catch (error) {
        console.error('发送验证码错误:', error);
        showToast('error', '发送验证码失败，请稍后重试');
        resetCodeButton();
    }
}

// 注册表单处理
document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('registerForm');
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    
    if (registerForm) {
        // 发送验证码按钮点击事件
        sendCodeBtn.addEventListener('click', async () => {
            const email = document.getElementById('email').value;
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showToast('error', '请输入正确的邮箱地址');
                return;
            }
            await sendVerificationCode(email);
        });

        // 注册表单提交
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const code = document.getElementById('verifyCode').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            // 验证密码
            if (password !== confirmPassword) {
                showToast('error', '两次输入的密码不一致');
                return;
            }
            
            try {
                const response = await fetch('http://localhost:3000/api/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email,
                        code,
                        password
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showToast('success', '注册成功！');
                    setTimeout(() => {
                        window.location.href = '/auth/login.html';
                    }, 1500);
                } else {
                    showToast('error', data.error || '注册失败');
                }
            } catch (error) {
                console.error('注册错误:', error);
                showToast('error', '注册失败，请稍后重试');
            }
        });
    }
});

// 登录表单处理
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const rememberMe = document.getElementById('rememberMe').checked;
            
            try {
                const response = await fetch('http://localhost:3000/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        email,
                        password
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // 保存token和用户信息
                    auth.token = data.token;
                    auth.user = data.user;
                    
                    if (rememberMe) {
                        localStorage.setItem('token', data.token);
                        localStorage.setItem('user', JSON.stringify(data.user));
                    } else {
                        sessionStorage.setItem('token', data.token);
                        sessionStorage.setItem('user', JSON.stringify(data.user));
                    }
                    
                    showToast('success', '登录成功！');
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 1500);
                } else {
                    showToast('error', data.error || '登录失败');
                }
            } catch (error) {
                console.error('登录错误:', error);
                showToast('error', '登录失败，请稍后重试');
            }
        });
    }
});

// 显示提示框
function showToast(type, message) {
    const toast = document.getElementById('toast');
    const toastBody = toast.querySelector('.toast-body');
    const toastHeader = toast.querySelector('.toast-header');
    
    // 设置提示类型样式
    toast.className = 'toast';
    toast.classList.add(type === 'success' ? 'bg-success' : 'bg-danger');
    toast.classList.add('text-white');
    
    // 设置图标
    const icon = toastHeader.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle me-2' : 'fas fa-exclamation-circle me-2';
    
    // 设置消息
    toastBody.textContent = message;
    
    // 显示提示框
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
} 