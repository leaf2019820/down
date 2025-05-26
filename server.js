const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { Worker } = require('worker_threads');
require('dotenv').config();
const { initDatabase } = require('./server/utils/database');
const jwt = require('jsonwebtoken');

const app = express();

// 跨域配置
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400
}));
app.use(express.json());

// 静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// JWT 校验中间件（放在所有路由前）
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log('收到请求:', {
    path: req.path,
    method: req.method,
    hasAuthHeader: !!authHeader
  });

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.email.split('@')[0]
      };
      console.log('用户已认证:', req.user);
    } catch (err) {
      console.error('Token 验证失败:', err.message);
      req.user = undefined;
    }
  } else {
    console.log('未提供认证信息');
    req.user = undefined;
  }
  next();
});

// 引入路由
const authRouter = require('./server/routes/auth');
app.use('/api/auth', authRouter);

// 常量配置
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const USER_DIR = path.join(__dirname, 'data', 'users');
const TEMP_DIR = path.join(__dirname, 'temp');  // 临时文件目录在项目根目录
const HISTORY_FILE = path.join(__dirname, 'history.json');
const PORT = 3000;

// 初始化目录和历史文件
fs.ensureDirSync(DOWNLOAD_DIR);
fs.ensureDirSync(USER_DIR);
fs.ensureDirSync(TEMP_DIR);

if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeJSONSync(HISTORY_FILE, []);
}

// 内存存储
const progressMap = new Map();
const tasks = new Map();

// 辅助函数：获取用户目录
function getUserDir(username) {
  const userDir = path.join(USER_DIR, username);
  fs.ensureDirSync(userDir);
  return userDir;
}

// 辅助函数：获取用户下载记录文件路径
function getUserHistoryFile(username) {
  return path.join(getUserDir(username), 'history.json');
}

// 辅助函数：初始化用户下载记录
function initUserHistory(username) {
  const historyFile = getUserHistoryFile(username);
  if (!fs.existsSync(historyFile)) {
    fs.writeJSONSync(historyFile, []);
  }
}

// 辅助函数：读取用户下载记录
async function readUserHistory(username) {
  const historyFile = getUserHistoryFile(username);
  // 确保文件存在
  if (!fs.existsSync(historyFile)) {
    fs.writeJSONSync(historyFile, []);
  }
  return await fs.readJSON(historyFile);
}

// 辅助函数：写入用户下载记录
async function writeUserHistory(username, history) {
  const historyFile = getUserHistoryFile(username);
  // 确保目录存在
  fs.ensureDirSync(path.dirname(historyFile));
  await fs.writeJSON(historyFile, history);
}

// 辅助函数：读取全局下载记录
async function readGlobalHistory() {
  return await fs.readJSON(HISTORY_FILE);
}

// 辅助函数：写入全局下载记录
async function writeGlobalHistory(history) {
  await fs.writeJSON(HISTORY_FILE, history);
}

// 辅助函数：生成唯一文件名
function getUniqueFilename(dir, originalFilename, history) {
  const ext = path.extname(originalFilename);
  const base = originalFilename.replace(ext, '');
  let counter = 1;
  let newFilename = originalFilename;
  const existingHistoryFilenames = history.map(item => item.filename);
  
  while (existingHistoryFilenames.includes(newFilename) || fs.existsSync(path.join(dir, newFilename))) {
    newFilename = `${base}(${counter})${ext}`;
    counter++;
  }
  return newFilename;
}

// 定时清理临时文件（每小时清理一次）
setInterval(async () => {
  try {
    const files = await fs.readdir(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = await fs.stat(filePath);
      // 删除超过1小时的临时文件
      if (Date.now() - stats.mtime.getTime() > 3600000) {
        await fs.remove(filePath);
      }
    }
  } catch (error) {
    console.error('清理临时文件失败:', error);
  }
}, 3600000);

// 下载文件到服务器接口
app.post('/download', async (req, res) => {
  const { url } = req.body;
  const username = req.user?.username; // 从JWT中获取用户名
  
  if (!url) return res.status(400).json({ error: '缺少下载链接' });

  const taskId = uuidv4();
  const tempFilePath = path.join(TEMP_DIR, taskId);
  const originalFilename = url.split('/').pop().split('?')[0];
  
  let finalFilePath;
  let history;
  
  try {
    if (username) {
      // 登录用户：使用用户专属目录
      console.log(`用户 ${username} 开始下载文件`);
      const userDir = getUserDir(username);
      console.log(`用户目录: ${userDir}`);
      
      // 确保用户目录存在
      await fs.ensureDir(userDir);
      
      history = await readUserHistory(username);
      const uniqueFilename = getUniqueFilename(userDir, originalFilename, history);
      finalFilePath = path.join(userDir, uniqueFilename);
      console.log(`最终文件路径: ${finalFilePath}`);
    } else {
      // 未登录用户：使用原有目录
      console.log('未登录用户开始下载文件');
      history = await readGlobalHistory();
      const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename, history);
      finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename);
      console.log(`最终文件路径: ${finalFilePath}`);
    }

    // 初始化进度和历史记录
    progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });
    const historyRecord = {
      id: taskId,
      filename: path.basename(finalFilePath),
      url,
      status: '下载中',
      timestamp: new Date().toISOString(),
      size: ''
    };
    
    if (username) {
      history.push(historyRecord);
      await writeUserHistory(username, history);
      console.log(`已更新用户 ${username} 的下载记录`);
    } else {
      history.push(historyRecord);
      await writeGlobalHistory(history);
      console.log('已更新全局下载记录');
    }

    const worker = new Worker(path.join(__dirname, 'download-worker.js'), {
      workerData: { taskId, url, tempFilePath, finalFilePath, uniqueFilename: path.basename(finalFilePath) }
    });

    worker.on('message', async (progress) => {
      progressMap.set(taskId, progress);
      if (progress.status === 'completed') {
        if (username) {
          const history = await readUserHistory(username);
          const index = history.findIndex(item => item.id === taskId);
          if (index !== -1) {
            history[index].status = 'completed';
            history[index].size = progress.totalSize;
            await writeUserHistory(username, history);
            console.log(`用户 ${username} 的文件下载完成: ${path.basename(finalFilePath)}`);
          }
        } else {
          const history = await readGlobalHistory();
          const index = history.findIndex(item => item.id === taskId);
          if (index !== -1) {
            history[index].status = 'completed';
            history[index].size = progress.totalSize;
            await writeGlobalHistory(history);
            console.log(`未登录用户的文件下载完成: ${path.basename(finalFilePath)}`);
          }
        }
      }
    });

    tasks.set(taskId, { worker, tempPath: tempFilePath, filename: path.basename(finalFilePath) });
    res.json({ taskId, filename: path.basename(finalFilePath), message: '开始下载' });
  } catch (error) {
    console.error('下载初始化失败:', error);
    progressMap.set(taskId, { percent: 0, speed: 0, status: '下载失败' });
    res.status(500).json({ error: '下载失败: ' + error.message });
  }
});

// 获取下载进度接口
app.get('/progress/:taskId', (req, res) => {
  const progress = progressMap.get(req.params.taskId);
  res.json(progress || { percent: 0, speed: 0, status: 'not_found' });
});

// 获取下载历史接口
app.get('/history', async (req, res) => {
  const username = req.user?.username;
  
  try {
    if (username) {
      // 登录用户：返回用户专属历史记录
      console.log(`获取用户 ${username} 的下载历史`);
      // 确保用户目录和历史文件存在
      initUserHistory(username);
      const history = await readUserHistory(username);
      res.json(history);
    } else {
      // 未登录用户：返回原有历史记录
      console.log('获取未登录用户的下载历史');
      const history = await readGlobalHistory();
      res.json(history);
    }
  } catch (error) {
    console.error('获取历史记录失败:', error);
    res.status(500).json({ error: '获取历史记录失败: ' + error.message });
  }
});

// 下载文件到本地接口
app.get('/download-file/:filename', (req, res) => {
  const username = req.user?.username;
  let filePath;
  
  if (username) {
    // 登录用户：从用户专属目录下载
    filePath = path.join(getUserDir(username), req.params.filename);
  } else {
    // 未登录用户：从原有目录下载
    filePath = path.join(DOWNLOAD_DIR, req.params.filename);
  }
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.download(filePath);
});

// 删除记录
app.delete('/delete-record/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let historyFile;
    let history;
    let fileDir;

    // 检查用户是否登录
    if (req.user) {
      // 已登录用户：删除用户特定的历史记录和文件
      const userDir = path.join(USER_DIR, req.user.email.split('@')[0]);
      historyFile = path.join(userDir, 'history.json');
      fileDir = userDir;
      console.log('已登录用户删除记录:', {
        user: req.user.email,
        historyFile,
        fileDir
      });
    } else {
      // 未登录用户：删除公共历史记录和文件
      historyFile = HISTORY_FILE;
      fileDir = DOWNLOAD_DIR;
      console.log('未登录用户删除记录:', {
        historyFile,
        fileDir
      });
    }

    // 读取历史记录
    if (await fs.pathExists(historyFile)) {
      history = await fs.readJSON(historyFile);
    } else {
      history = [];
    }

    // 查找记录
    const index = history.findIndex(item => item.id === id);
    if (index === -1) {
      console.log('记录不存在:', {
        id,
        historyLength: history.length,
        isLoggedIn: !!req.user
      });
      return res.status(404).json({ error: '记录不存在' });
    }

    // 获取要删除的文件信息
    const record = history[index];
    const filePath = path.join(fileDir, record.filename);

    // 删除文件（如果存在）
    if (await fs.pathExists(filePath)) {
      try {
        await fs.remove(filePath);
        console.log('文件删除成功:', {
          filePath,
          isLoggedIn: !!req.user
        });
      } catch (error) {
        console.error('文件删除失败:', {
          filePath,
          error: error.message
        });
        // 继续执行，即使文件删除失败
      }
    }

    // 删除记录
    history.splice(index, 1);
    await fs.writeJSON(historyFile, history);

    console.log('记录删除成功:', {
      id,
      remainingRecords: history.length,
      isLoggedIn: !!req.user
    });

    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除记录失败:', error);
    res.status(500).json({ error: '删除记录失败' });
  }
});

// 取消下载接口（整合重复的取消接口）
app.delete('/cancel-download/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) return res.status(404).json({ error: '任务不存在' });

  task.worker.terminate();
  if (await fs.pathExists(task.tempPath)) await fs.remove(task.tempPath);
  tasks.delete(taskId);

  const history = await readUserHistory(req.user.username);
  const recordIndex = history.findIndex(item => item.id === taskId);
  if (recordIndex !== -1) {
    history.splice(recordIndex, 1);
    await writeUserHistory(req.user.username, history);
  }

  res.json({ message: '任务已取消并删除' });
});

// 初始化数据库
initDatabase().then(() => {
  // 启动服务器
  app.listen(PORT, () => {
    console.log(`服务运行在 http://127.0.0.1:${PORT}`);
    console.log(`服务运行在 http://公网IP:${PORT}`);
  });
}).catch(error => {
  console.error('服务器启动失败:', error);
});