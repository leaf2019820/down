// 初始化 DOM 元素引用
const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const progressArea = document.getElementById('progressArea');
const progressBar = document.getElementById('progressBar');
const percentSpan = document.getElementById('percent');
const speedSpan = document.getElementById('speed');
const historyList = document.getElementById('historyList');
const cancelBtn = document.getElementById('cancelBtn');
const etaSpan = document.getElementById('eta');
const totalSizeSpan = document.getElementById('totalSize');

// 存储当前任务ID和定时器ID的变量
const activeTasks = new Map(); // 键：taskId，值：{ intervalId, domElement }

// 下载按钮点击事件修改（关键修改点）
downloadBtn.addEventListener('click', async () => {
  const input = urlInput.value.trim();
  if (!input) {
    showInputAlert('请输入下载链接');
    return;
  }

  // 分割并过滤空行
  const urls = input.split('\n').map(url => url.trim()).filter(url => url);
  if (urls.length === 0) {
    showInputAlert('请输入有效的下载链接');
    return;
  }

  // 验证URL格式（必须以http/https开头）
  const invalidUrls = urls.filter(url => !/^https?:\/\//i.test(url));
  if (invalidUrls.length > 0) {
    showInputAlert(`以下链接格式不正确（需以http/https开头）：\n${invalidUrls.join('\n')}`);
    return;
  }

  // 清空输入框
  urlInput.value = '';

  // 批量启动下载任务
  for (const url of urls) {
    try {
      const response = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const { taskId } = await response.json();
      
      // 创建新任务的DOM容器并添加到任务列表
      const taskElement = createTaskElement(taskId);
      activeTasksList.appendChild(taskElement);
      
      // 启动进度跟踪
      const intervalId = trackProgress(taskId, taskElement);
      activeTasks.set(taskId, { intervalId, domElement: taskElement });
    } catch (error) {
      console.error('下载请求失败:', error);
      showToast('部分任务启动失败');
    }
  }
});

// 新增输入提示函数（复用现有模态框）
function showInputAlert(message) {
  const inputAlertModal = document.getElementById('inputAlertModal');
  const alertContent = inputAlertModal.querySelector('p');
  alertContent.textContent = message;
  inputAlertModal.style.display = 'flex';
  
  // 确认按钮点击事件
  document.querySelector('.input-alert-confirm-btn').onclick = () => {
    inputAlertModal.style.display = 'none';
  };
  
  inputAlertModal.onclick = (e) => e.target === inputAlertModal && (inputAlertModal.style.display = 'none');
}

// 跟踪进度逻辑
function trackProgress(taskId, taskElement) {
  const intervalId = setInterval(async () => {
    const response = await fetch(`/progress/${taskId}`);
    const progress = await response.json();
    
    const percentSpan = taskElement.querySelector('.percent');
    const speedSpan = taskElement.querySelector('.speed');
    const progressBar = taskElement.querySelector('.progress');
    const etaSpan = taskElement.querySelector('.eta');  // 新增：获取预计时间元素
    const totalSizeSpan = taskElement.querySelector('.totalSize');  // 新增：获取总大小元素

    if (progress.status === 'completed') {
      clearInterval(intervalId);
      activeTasks.delete(taskId);
      taskElement.remove();
      loadHistory();
    } else {
      // 新增：计算总大小（MB）
      const totalSizeMB = progress.total ? (progress.total / 1024 / 1024).toFixed(2) : '未知';
      // 新增：计算预计完成时间（eta）
      const loadedBytes = (progress.percent / 100) * (progress.total || 0);
      const remainingBytes = (progress.total || 0) - loadedBytes;
      const speedBytesPerSecond = progress.speed * 1024 * 1024;  // 转换为字节/秒
      const eta = speedBytesPerSecond > 0 ? 
        `${Math.floor(remainingBytes / speedBytesPerSecond)}秒` : '未知';

      // 更新新增字段
      totalSizeSpan.textContent = `${totalSizeMB}MB`;
      etaSpan.textContent = eta;
      
      // 原有更新逻辑
      progressBar.style.width = `${progress.percent}%`;
      percentSpan.textContent = `${progress.percent}%`;
      speedSpan.textContent = `${progress.speed} MB/s`;
    }
  }, 500);
  return intervalId;
}

// 加载下载记录逻辑
async function loadHistory() {
  const response = await fetch('/history');
  const history = await response.json();
  // 新增"cancelled"状态映射
  const statusMap = { 
    downloading: '下载中', 
    completed: '下载完成', 
    failed: '下载失败', 
    cancelled: '已取消',  // 新增
    not_found: '未找到' 
  };

  historyList.innerHTML = history.map(item => 
    `<div class="history-item">
      <p>文件名：${item.filename}</p>
      <p>文件大小：${item.size || '未知'}</p>
      <p>状态：${statusMap[item.status] || item.status}</p>
      <p>时间：${new Date(item.timestamp).toLocaleString()}</p>
      ${item.status === 'completed' ? `<a href="/download-file/${encodeURIComponent(item.filename)}">下载到本地</a>` : ''}
      <button class="delete-btn" data-id="${item.id}">删除文件</button>
    </div>`
  ).join('');

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.id;
      const deleteModal = document.getElementById('deleteModal');
      const toast = document.getElementById('toast');
      deleteModal.style.display = 'flex';
  
      // 绑定确认按钮事件
      document.querySelector('.delete-confirm-btn').onclick = async () => {
        try {
          await fetch(`/delete-record/${taskId}`, { method: 'DELETE' });
          toast.style.display = 'block';
          setTimeout(() => toast.style.display = 'none', 2000);
          loadHistory();
        } catch (error) {
          alert('删除失败：' + error.message);
        }
        deleteModal.style.display = 'none';
      };
  
      // 新增：绑定取消按钮事件
      document.querySelector('.delete-cancel-btn').onclick = () => {
        deleteModal.style.display = 'none';
      };
  
      deleteModal.onclick = (e) => e.target === deleteModal && (deleteModal.style.display = 'none');
    });
  });
}

// 取消按钮逻辑（修改部分）
cancelBtn.addEventListener('click', async () => {
  const cancelModal = document.getElementById('cancelModal');
  cancelModal.style.display = 'flex';

  document.getElementById('cancelModalConfirm').onclick = async () => {
    try {
      // 调用取消接口通知服务端终止工作线程
      await fetch(`/cancel-download/${currentTaskId}`, { method: 'DELETE' });
      
      // 清理本地状态
      clearInterval(progressInterval);
      progressArea.style.display = 'none';
      cancelBtn.style.display = 'none';
      downloadBtn.disabled = false;
      urlInput.value = '';
      loadHistory();
      
      // 显示提示
      const toast = document.getElementById('toast');
      toast.textContent = '取消成功！';
      toast.style.display = 'block';
      setTimeout(() => toast.style.display = 'none', 2000);
    } catch (error) {
      alert(`取消失败：${error.message}`);
    }
    cancelModal.style.display = 'none';
  };

  document.getElementById('cancelModalCancel').onclick = () => cancelModal.style.display = 'none';
  cancelModal.onclick = (e) => e.target === cancelModal && (cancelModal.style.display = 'none');
});

// 初始化加载记录
loadHistory();


function createTaskElement(taskId) {
  const div = document.createElement('div');
  div.className = 'active-task';
  div.innerHTML = `
    <div class="progress-bar">
      <div class="progress" data-task-id="${taskId}"></div>
    </div>
    <div class="task-info">
      已下载：<span class="percent">0%</span> | 
      速度：<span class="speed">0MB</span> | 
      预计完成：<span class="eta">未知</span> | 
      总大小：<span class="totalSize">0MB</span> | 
      <button class="cancel-btn" data-task-id="${taskId}">取消并删除</button>
    </div>
  `;

  // 新增：绑定单个任务的取消按钮事件
  const cancelBtn = div.querySelector('.cancel-btn');
  cancelBtn.addEventListener('click', async () => {
    const taskId = cancelBtn.dataset.taskId;
    const cancelModal = document.getElementById('cancelModal');
    cancelModal.style.display = 'flex';

    // 确认取消逻辑
    document.getElementById('cancelModalConfirm').onclick = async () => {
      try {
        await fetch(`/cancel-download/${taskId}`, { method: 'DELETE' });
        // 清理前端状态
        clearInterval(activeTasks.get(taskId).intervalId);
        activeTasks.delete(taskId);
        div.remove();
        loadHistory(); // 刷新历史记录
        // 显示提示
        const toast = document.getElementById('toast');
        toast.textContent = '取消成功！';
        toast.style.display = 'block';
        setTimeout(() => toast.style.display = 'none', 2000);
      } catch (error) {
        alert(`取消失败：${error.message}`);
      }
      cancelModal.style.display = 'none';
    };

    // 取消按钮关闭模态框
    document.getElementById('cancelModalCancel').onclick = () => {
      cancelModal.style.display = 'none';
    };
    cancelModal.onclick = (e) => e.target === cancelModal && (cancelModal.style.display = 'none');
  });

  return div;
}