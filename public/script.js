// 初始化关键 DOM 元素引用（仅保留实际使用的）
const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const historyList = document.getElementById('historyList');
const activeTasksList = document.getElementById('activeTasksList'); // 动态任务列表容器

// 存储当前任务ID和定时器ID的变量（键：taskId，值：{ intervalId, domElement }）
const activeTasks = new Map();

// 下载按钮点击事件（核心逻辑）
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

  urlInput.value = ''; // 清空输入框

  // 批量启动下载任务
  for (const url of urls) {
    try {
      const response = await fetch('/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const { taskId, filename } = await response.json();
      
      // 创建任务元素并添加到列表
      const taskElement = createTaskElement(taskId, filename);
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

// 输入提示模态框（复用现有结构）
function showInputAlert(message) {
  const inputAlertModal = document.getElementById('inputAlertModal');
  const alertContent = inputAlertModal.querySelector('p');
  alertContent.textContent = message;
  inputAlertModal.style.display = 'flex';
  
  // 统一使用 addEventListener 绑定事件
  const confirmBtn = inputAlertModal.querySelector('.input-alert-confirm-btn');
  confirmBtn.addEventListener('click', () => inputAlertModal.style.display = 'none');
  inputAlertModal.addEventListener('click', (e) => {
    if (e.target === inputAlertModal) inputAlertModal.style.display = 'none';
  });
}

// 进度跟踪逻辑（核心）
function trackProgress(taskId, taskElement) {
  return setInterval(async () => {
    const response = await fetch(`/progress/${taskId}`);
    const progress = await response.json();
    
    // 从动态元素中获取子节点（避免全局变量）
    const percentSpan = taskElement.querySelector('.percent');
    const speedSpan = taskElement.querySelector('.speed');
    const progressBar = taskElement.querySelector('.progress');
    const etaSpan = taskElement.querySelector('.eta');
    const totalSizeSpan = taskElement.querySelector('.totalSize');

    if (progress.status === 'completed') {
      clearInterval(this); // 清理定时器
      activeTasks.delete(taskId);
      taskElement.remove();
      loadHistory(); // 刷新历史记录
      return;
    }

    // 计算总大小（MB）
    const totalSizeMB = progress.total ? (progress.total / 1024 / 1024).toFixed(2) : '未知';
    // 计算预计完成时间（直接使用 progress.loaded 避免冗余计算）
    const remainingBytes = (progress.total || 0) - progress.loaded;
    const speedBytesPerSecond = progress.speed * 1024 * 1024;
    const totalSeconds = speedBytesPerSecond > 0 ? Math.floor(remainingBytes / speedBytesPerSecond) : 0;

    // 格式化预计时间
    let eta;
    if (totalSeconds <= 0) {
      eta = '未知';
    } else {
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      const parts = [];
      if (hours > 0) parts.push(`${hours}小时`);
      if (minutes > 0) parts.push(`${minutes}分钟`);
      parts.push(`${seconds}秒`);
      eta = parts.join('');
    }

    // 更新界面
    progressBar.style.width = `${progress.percent}%`;
    totalSizeSpan.textContent = `${totalSizeMB}MB`;
    etaSpan.textContent = eta;
    speedSpan.textContent = `${progress.speed} MB/s`;
    percentSpan.textContent = progress.total > 0 ? 
      `${progress.percent}%` : 
      `${(progress.loaded / 1024 / 1024).toFixed(2)} MB`;
  }, 500);
}

// 加载下载历史（核心）
async function loadHistory() {
  const response = await fetch('/history');
  const history = await response.json();
  
  // 处理空历史状态
  if (history.length === 0) {
    historyList.innerHTML = '<div class="empty-history" style="color: #666; font-size: 14px; text-align: center; padding: 20px;">诶，下载记录怎么空了</div>';
    return;
  }

  // 渲染历史记录
  const statusMap = { 
    downloading: '下载中', 
    completed: '下载完成', 
    failed: '下载失败', 
    cancelled: '已取消', 
    not_found: '未找到' 
  };
  historyList.innerHTML = history.map(item => `
    <div class="history-item">
      <p>文件名：${item.filename}</p>
      <p>文件大小：${item.size || '未知'}MB</p>
      <p>状态：${statusMap[item.status] || item.status}</p>
      <p>时间：${new Date(item.timestamp).toLocaleString()}</p>
      ${item.status === 'completed' ? `<a href="/download-file/${encodeURIComponent(item.filename)}">下载到本地</a>` : ''}
      <button class="delete-btn" data-id="${item.id}">删除文件</button>
    </div>
  `).join('');

  // 绑定删除按钮事件
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const taskId = btn.dataset.id;
      const deleteModal = document.getElementById('deleteModal');
      const toast = document.getElementById('toast');
      deleteModal.style.display = 'flex';

      // 确认删除逻辑
      const confirmDelete = async () => {
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

      // 取消删除逻辑
      const cancelDelete = () => deleteModal.style.display = 'none';

      // 绑定事件（清理重复的 onclick 赋值）
      document.querySelector('.delete-confirm-btn').addEventListener('click', confirmDelete);
      document.querySelector('.delete-cancel-btn').addEventListener('click', cancelDelete);
      deleteModal.addEventListener('click', (e) => e.target === deleteModal && cancelDelete());
    });
  });
}

// 取消任务逻辑（核心）
function bindCancelTaskEvent(taskId, cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    const cancelModal = document.getElementById('cancelModal');
    cancelModal.style.display = 'flex';

    // 确认取消逻辑
    const confirmCancel = async () => {
      try {
        await fetch(`/cancel-download/${taskId}`, { method: 'DELETE' });
        // 清理前端状态
        const task = activeTasks.get(taskId);
        clearInterval(task.intervalId);
        activeTasks.delete(taskId);
        task.domElement.remove();
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

    // 取消取消逻辑
    const cancelCancel = () => cancelModal.style.display = 'none';

    // 绑定事件（清理重复的 onclick 赋值）
    document.getElementById('cancelModalConfirm').addEventListener('click', confirmCancel);
    document.getElementById('cancelModalCancel').addEventListener('click', cancelCancel);
    cancelModal.addEventListener('click', (e) => e.target === cancelModal && cancelCancel());
  });
}

// 创建任务元素（核心）
function createTaskElement(taskId, filename) {
  const div = document.createElement('div');
  div.className = 'active-task';
  div.innerHTML = `
    <p class="task-filename" style="font-weight: bold; margin-bottom: 8px;">当前文件：${filename}</p>
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

  // 绑定取消按钮事件（提取为独立函数）
  bindCancelTaskEvent(taskId, div.querySelector('.cancel-btn'));
  return div;
}

// 初始化加载历史记录
loadHistory();