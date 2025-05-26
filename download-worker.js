const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

const { taskId, url, tempFilePath, finalFilePath, uniqueFilename } = workerData;

// 下载进度跟踪变量
let lastLoaded = 0;
let lastTime = Date.now();

async function startDownload() {
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      onDownloadProgress: (progressEvent) => {
        const total = progressEvent.total || 0;
        const loaded = progressEvent.loaded;
        
        // 计算实时网速（MB/s）
        const currentTime = Date.now();
        const timeDiff = (currentTime - lastTime) / 1000; 
        const loadedDiff = loaded - lastLoaded;
        const speed = timeDiff > 0 ? (loadedDiff / 1024 / 1024 / timeDiff).toFixed(2) : 0;
        
        lastLoaded = loaded;
        lastTime = currentTime;

        // 计算下载百分比
        let percent = 0;
        if (total > 0) {
          percent = Math.min(100, Math.round((loaded / total) * 100));
        }

        // 向主线程发送进度
        parentPort.postMessage({ 
          percent, 
          speed, 
          total, 
          loaded, 
          status: '下载中' 
        });
      }
    });

    const writer = fs.createWriteStream(tempFilePath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // 移动临时文件到最终目录
    await fs.move(tempFilePath, finalFilePath);

    // 获取文件大小并发送完成状态
    const stats = await fs.stat(finalFilePath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    parentPort.postMessage({ 
      percent: 100, 
      speed: 0, 
      status: 'completed', 
      totalSize: fileSizeMB 
    });

    // 延迟退出确保消息传递
    setTimeout(() => process.exit(0), 100);
  } catch (error) {
    parentPort.postMessage({ percent: 0, speed: 0, status: '下载失败' });
    process.exit(1);
  }
}

startDownload();