const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { Worker } = require('worker_threads'); // 新增：引入工作线程模块

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
function getUniqueFilename(dir, originalFilename, history) {
  const ext = path.extname(originalFilename);
  const base = originalFilename.replace(ext, '');
  let counter = 1;
  let newFilename = originalFilename;
  
  // 获取历史记录中已有的文件名列表
  const existingHistoryFilenames = history.map(item => item.filename);
  
  // 循环检测直到找到未存在的文件名（同时检查历史记录和存储目录）
  while (existingHistoryFilenames.includes(newFilename) || fs.existsSync(path.join(dir, newFilename))) {
    newFilename = `${base}(${counter})${ext}`;
    counter++;
  }
  return newFilename;
}

// 内存存储任务：taskId -> { cancel: Function, tempPath: String, filename: String }
const tasks = new Map();

// 下载文件到服务器接口
app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少下载链接' });

  const taskId = uuidv4(); 
  const tempFilePath = path.join(TEMP_DIR, taskId); 
  const originalFilename = url.split('/').pop().split('?')[0];  
  const history = fs.readJSONSync(HISTORY_FILE); // 读取当前历史记录
  
  // 传递历史记录给文件名生成函数
  const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename, history);
  const finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename); 

  // 初始化进度和历史记录
  progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });
  const history = fs.readJSONSync(HISTORY_FILE);
  history.push({
    id: taskId,
    filename: uniqueFilename,
    url,
    status: '下载中',
    timestamp: new Date().toISOString(),
    size: '' 
  });
  fs.writeJSONSync(HISTORY_FILE, history);

  try {
    // 创建工作线程处理下载任务
    const worker = new Worker(path.join(__dirname, 'download-worker.js'), {
      workerData: {
        taskId,
        url,
        tempFilePath,
        finalFilePath,
        uniqueFilename
      }
    });

    // 监听工作线程的进度消息
    worker.on('message', (progress) => {
      progressMap.set(taskId, progress);
      
      // 新增：当状态为completed时更新历史记录的size
      if (progress.status === 'completed') {
        const history = fs.readJSONSync(HISTORY_FILE);
        const index = history.findIndex(item => item.id === taskId);
        if (index !== -1) {
          history[index].status = 'completed';
          history[index].size = progress.totalSize; // 写入文件大小
          fs.writeJSONSync(HISTORY_FILE, history);
        }
      }
    });
    
    // 原exit事件监听可移除，因为message事件已处理完成状态
    // worker.on('exit', (code) => { ... });  // 注释或删除此行
    
    tasks.set(taskId, { worker, tempPath: tempFilePath, filename: uniqueFilename });
    res.json({ taskId, message: '开始下载' });
  } catch (error) {
    progressMap.set(taskId, { percent: 0, speed: 0, status: '下载失败' });
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

// 新增：取消下载接口
// 取消下载接口
app.delete('/cancel-download/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  // 终止工作线程
  task.worker.terminate();
  
  // 删除临时文件（关键新增）
  if (await fs.pathExists(task.tempPath)) {
    await fs.remove(task.tempPath);
  }
  
  // 从任务列表中移除
  tasks.delete(taskId);
  
  // 从历史记录中删除该任务（已有逻辑优化）
  const history = fs.readJSONSync(HISTORY_FILE);
  const recordIndex = history.findIndex(item => item.id === taskId);
  if (recordIndex !== -1) {
    history.splice(recordIndex, 1);
    fs.writeJSONSync(HISTORY_FILE, history);
  }
  
  res.json({ message: '任务已取消并删除' });
});

// 在下载接口中存储取消句柄（关键修改）
app.post('/download', async (req, res) => {
  const { url } = req.body;
  const taskId = uuidv4();
  const tempFilePath = path.join(TEMP_DIR, taskId);
  const originalFilename = url.split('/').pop().split('?')[0];
  const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename);
  const finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename);

  // 新增：记录下载进度的时间戳和已加载字节数
  let lastLoaded = 0;
  let lastTime = Date.now();

  // 初始化进度和历史记录
  progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });
  const history = fs.readJSONSync(HISTORY_FILE);
  history.push({
    id: taskId,
    filename: uniqueFilename,
    url,
    status: '下载中',
    timestamp: new Date().toISOString(),
    size: '' 
  });
  fs.writeJSONSync(HISTORY_FILE, history);

  const controller = new AbortController(); // 新增AbortController
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      signal: controller.signal, // 关联取消信号
      onDownloadProgress: (progressEvent) => { /* ... */ }
    });

    // 存储取消句柄到tasks（关键）
    tasks.set(taskId, {
      cancel: () => controller.abort(),
      tempPath: tempFilePath,
      filename: uniqueFilename
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

// 原：同步读写历史文件（可能阻塞）
// const history = fs.readJSONSync(HISTORY_FILE);
// fs.writeJSONSync(HISTORY_FILE, history);

// 改为异步读写（非阻塞）并添加错误处理
async function readHistory() {
  try {
    return await fs.readJSON(HISTORY_FILE);
  } catch (error) {
    console.error('读取历史记录失败:', error);
    return [];
  }
}

async function writeHistory(history) {
  try {
    await fs.writeJSON(HISTORY_FILE, history);
  } catch (error) {
    console.error('写入历史记录失败:', error);
  }
}

// 在需要的地方替换为异步调用（示例）
app.post('/download', async (req, res) => {
  const { url } = req.body;
  const taskId = uuidv4();
  const tempFilePath = path.join(TEMP_DIR, taskId);
  const originalFilename = url.split('/').pop().split('?')[0];
  const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename);
  const finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename);

  // 新增：记录下载进度的时间戳和已加载字节数
  let lastLoaded = 0;
  let lastTime = Date.now();

  // 初始化进度和历史记录
  progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });
  const history = await readHistory(); // 异步读取
  history.push({
    id: taskId,
    filename: uniqueFilename,
    url,
    status: '下载中',
    timestamp: new Date().toISOString(),
    size: '' 
  });
  await writeHistory(history); // 异步写入

  const controller = new AbortController(); // 新增AbortController
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      signal: controller.signal, // 关联取消信号
      onDownloadProgress: (progressEvent) => { /* ... */ }
    });

    // 存储取消句柄到tasks（关键）
    tasks.set(taskId, {
      cancel: () => controller.abort(),
      tempPath: tempFilePath,
      filename: uniqueFilename
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
