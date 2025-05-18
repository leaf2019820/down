const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
// 优化跨域配置
app.use(cors({
  origin: '*', // 开发阶段允许所有源，生产环境建议改为具体前端域名（如http://your-frontend.com）
  methods: ['GET', 'POST', 'DELETE'], // 明确允许的请求方法
  allowedHeaders: ['Content-Type'], // 明确允许的请求头
  maxAge: 86400 // 预请求缓存时间（秒）
})); 
app.use(express.json());

// 配置静态文件目录（用于访问前端页面）
app.use(express.static(path.join(__dirname, 'public')));

// 配置常量
const DOWNLOAD_DIR = path.join(__dirname, 'downloads'); // 文件存储目录
const TEMP_DIR = path.join(__dirname, 'temp'); // 临时目录（下载中文件）
const HISTORY_FILE = path.join(__dirname, 'history.json'); // 下载记录文件
const PORT = 3000;

// 初始化目录和历史文件（启动时自动创建）
fs.ensureDirSync(DOWNLOAD_DIR);
fs.ensureDirSync(TEMP_DIR);
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeJSONSync(HISTORY_FILE, []);
}

// 内存存储下载进度（任务ID -> 进度信息）
const progressMap = new Map();

// 新增：生成唯一文件名的辅助函数
function getUniqueFilename(dir, originalFilename) {
  const ext = path.extname(originalFilename);
  const base = originalFilename.replace(ext, '');
  let counter = 1;
  let newFilename = originalFilename;
  
  // 循环检测直到找到未存在的文件名
  while (fs.existsSync(path.join(dir, newFilename))) {
    newFilename = `${base}(${counter})${ext}`;
    counter++;
  }
  return newFilename;
}

// 下载文件到服务器接口
app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少下载链接' });

  const taskId = uuidv4(); 
  const tempFilePath = path.join(TEMP_DIR, taskId); 
  const originalFilename = url.split('/').pop().split('?')[0];  // 原始文件名
  
  // 关键修改：生成唯一文件名
  const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename);
  const finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename); 

  // 新增：记录下载进度的时间戳和已加载字节数
  let lastLoaded = 0;
  let lastTime = Date.now();

  // 初始化进度和历史记录
  progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });  // 修改为中文状态
  const history = fs.readJSONSync(HISTORY_FILE);
  history.push({
    id: taskId,
    filename: uniqueFilename,
    url,
    status: '下载中',  // 修改为中文状态
    timestamp: new Date().toISOString(),
    size: '' 
  });
  fs.writeJSONSync(HISTORY_FILE, history);

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      onDownloadProgress: (progressEvent) => {
        const total = progressEvent.total; // 获取文件总大小（字节）
        const loaded = progressEvent.loaded;
        const percent = Math.round((loaded / total) * 100);
        
        // 计算实时网速（MB/s）
        const currentTime = Date.now();
        const timeDiff = (currentTime - lastTime) / 1000; 
        const loadedDiff = loaded - lastLoaded;
        const speed = timeDiff > 0 ? (loadedDiff / 1024 / 1024 / timeDiff).toFixed(2) : 0;
        
        lastLoaded = loaded;
        lastTime = currentTime;
        
        // 新增 total 字段（文件总大小，字节）
        progressMap.set(taskId, { percent, speed, total, status: 'downloading' });
      }
    });

    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    writer.on('finish', async () => {
      await fs.move(tempFilePath, finalFilePath);
      
      // 获取文件大小并更新历史记录（需要更新为唯一文件名）
      const stats = await fs.stat(finalFilePath);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      
      // 完成时更新进度和历史记录（关键修改：状态改为'completed'）
      progressMap.set(taskId, { 
        percent: 100, 
        speed: 0, 
        status: 'completed',  // 改为前端期望的'completed'
        totalSize: fileSizeMB 
      });
      
      const history = fs.readJSONSync(HISTORY_FILE);
      const index = history.findIndex(item => item.id === taskId);
      
      if (index === -1) {
        console.error(`任务 ${taskId} 历史记录不存在，跳过更新`);
        return;
      }

      history[index].status = 'completed';  // 历史记录状态同步改为'completed'
      history[index].filename = uniqueFilename;
      history[index].size = `${fileSizeMB} MB`; 
      fs.writeJSONSync(HISTORY_FILE, history);
    });

    res.json({ taskId, message: '开始下载' });
  } catch (error) {
    progressMap.set(taskId, { percent: 0, speed: 0, status: '下载失败' });  // 修改为中文状态
    res.status(500).json({ error: '下载失败' });
  }
});

// 获取下载进度接口
app.get('/progress/:taskId', (req, res) => {
  const progress = progressMap.get(req.params.taskId);
  res.json(progress || { percent: 0, speed: 0, status: 'not_found' });
});

// 获取下载历史接口
app.get('/history', (req, res) => {
  const history = fs.readJSONSync(HISTORY_FILE);
  res.json(history);
});

// 下载文件到本地接口（从服务器下载）
app.get('/download-file/:filename', (req, res) => {
  const filePath = path.join(DOWNLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.download(filePath);
});

// 删除下载记录及文件接口
app.delete('/delete-record/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const history = fs.readJSONSync(HISTORY_FILE);
  const recordIndex = history.findIndex(item => item.id === taskId);

  if (recordIndex === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }

  const record = history[recordIndex];
  
  // 删除服务器文件（仅当状态为completed时）
  if (record.status === 'completed') {
    const filePath = path.join(DOWNLOAD_DIR, record.filename);
    if (fs.existsSync(filePath)) {
      await fs.remove(filePath); // 删除文件
    }
  }

  // 从历史记录中移除
  history.splice(recordIndex, 1);
  fs.writeJSONSync(HISTORY_FILE, history);

  res.json({ message: '删除成功' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务运行在 http://127.0.0.1:${PORT}`);
  console.log(`服务运行在 http://公网IP:${PORT}`);
});
