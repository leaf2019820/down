const express = require('express');
const axios = require('axios');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const { Worker } = require('worker_threads');

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

// 常量配置
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const TEMP_DIR = path.join(__dirname, 'temp');
const HISTORY_FILE = path.join(__dirname, 'history.json');
const PORT = 3000;

// 初始化目录和历史文件
fs.ensureDirSync(DOWNLOAD_DIR);
fs.ensureDirSync(TEMP_DIR);
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeJSONSync(HISTORY_FILE, []);
}

// 内存存储
const progressMap = new Map();
const tasks = new Map();

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

// 辅助函数：异步读写历史记录
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

// 辅助函数：更新完成状态的历史记录
async function updateHistoryOnComplete(taskId, totalSize) {
  const history = await readHistory();
  const index = history.findIndex(item => item.id === taskId);
  if (index !== -1) {
    history[index].status = 'completed';
    history[index].size = totalSize;
    await writeHistory(history);
  }
}

// 下载文件到服务器接口（整合所有重复的下载接口）
app.post('/download', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少下载链接' });

  const taskId = uuidv4();
  const tempFilePath = path.join(TEMP_DIR, taskId);
  const originalFilename = url.split('/').pop().split('?')[0];
  const history = await readHistory();
  const uniqueFilename = getUniqueFilename(DOWNLOAD_DIR, originalFilename, history);
  const finalFilePath = path.join(DOWNLOAD_DIR, uniqueFilename);

  // 初始化进度和历史记录
  progressMap.set(taskId, { percent: 0, speed: 0, status: '下载中' });
  history.push({
    id: taskId,
    filename: uniqueFilename,
    url,
    status: '下载中',
    timestamp: new Date().toISOString(),
    size: ''
  });
  await writeHistory(history);

  try {
    const worker = new Worker(path.join(__dirname, 'download-worker.js'), {
      workerData: { taskId, url, tempFilePath, finalFilePath, uniqueFilename }
    });

    worker.on('message', (progress) => {
      progressMap.set(taskId, progress);
      if (progress.status === 'completed') {
        updateHistoryOnComplete(taskId, progress.totalSize);
      }
    });

    tasks.set(taskId, { worker, tempPath: tempFilePath, filename: uniqueFilename });
    res.json({ taskId, filename: uniqueFilename, message: '开始下载' });
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
app.get('/history', async (req, res) => {
  const history = await readHistory();
  res.json(history);
});

// 下载文件到本地接口
app.get('/download-file/:filename', (req, res) => {
  const filePath = path.join(DOWNLOAD_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '文件不存在' });
  }
  res.download(filePath);
});

// 删除下载记录及文件接口（整合重复的删除接口）
app.delete('/delete-record/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const history = await readHistory();
  const recordIndex = history.findIndex(item => item.id === taskId);

  if (recordIndex === -1) {
    return res.status(404).json({ error: '记录不存在' });
  }

  const record = history[recordIndex];
  if (record.status === 'completed') {
    const filePath = path.join(DOWNLOAD_DIR, record.filename);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
  }

  history.splice(recordIndex, 1);
  await writeHistory(history);
  res.json({ message: '删除成功' });
});

// 取消下载接口（整合重复的取消接口）
app.delete('/cancel-download/:taskId', async (req, res) => {
  const taskId = req.params.taskId;
  const task = tasks.get(taskId);

  if (!task) return res.status(404).json({ error: '任务不存在' });

  task.worker.terminate();
  if (await fs.pathExists(task.tempPath)) await fs.remove(task.tempPath);
  tasks.delete(taskId);

  const history = await readHistory();
  const recordIndex = history.findIndex(item => item.id === taskId);
  if (recordIndex !== -1) {
    history.splice(recordIndex, 1);
    await writeHistory(history);
  }

  res.json({ message: '任务已取消并删除' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务运行在 http://127.0.0.1:${PORT}`);
  console.log(`服务运行在 http://公网IP:${PORT}`);
});