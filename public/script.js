// 初始化关键 DOM 元素引用（仅保留实际使用的）
const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const historyList = document.getElementById('historyList');
const activeTasksList = document.getElementById('activeTasksList'); // 动态任务列表容器

// 存储当前任务ID和定时器ID的变量（键：taskId，值：{ intervalId, domElement }）
const activeTasks = new Map();

// 初始化Bootstrap组件
document.addEventListener('DOMContentLoaded', function() {
  // 初始化所有模态框
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    new bootstrap.Modal(modal);
  });

  // 初始化Toast
  const toastEl = document.getElementById('toast');
  const toast = new bootstrap.Toast(toastEl, {
    animation: true,
    autohide: true,
    delay: 3000
  });

  // 显示Toast的函数
  window.showToast = function(message, type = 'success') {
    const toastEl = document.getElementById('toast');
    const toastBody = toastEl.querySelector('.toast-body');
    toastBody.textContent = message;
    
    // 根据类型设置不同的背景色
    if (type === 'success') {
      toastEl.style.backgroundColor = '#22c55e';
    } else if (type === 'error') {
      toastEl.style.backgroundColor = '#ef4444';
    } else if (type === 'warning') {
      toastEl.style.backgroundColor = '#f59e0b';
    }
    
    const toast = new bootstrap.Toast(toastEl, {
      animation: true,
      autohide: true,
      delay: 3000
    });
    toast.show();
  };
});

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
  // 保存定时器 ID
  const intervalId = setInterval(async () => {
    try {
      const response = await fetch(`/progress/${taskId}`);
      if (!response.ok) throw new Error('获取进度失败');
      
      const progress = await response.json();
      
      // 从动态元素中获取子节点（避免全局变量）
      const percentSpan = taskElement.querySelector('.percent');
      const speedSpan = taskElement.querySelector('.speed');
      const progressBar = taskElement.querySelector('.progress');
      const etaSpan = taskElement.querySelector('.eta');
      const totalSizeSpan = taskElement.querySelector('.totalSize');

      if (progress.status === 'completed') {
        clearInterval(intervalId); // 显式清除当前定时器
        activeTasks.delete(taskId);
        taskElement.remove();
        
        // 检查是否还有其他任务
        if (activeTasks.size === 0) {
          // 如果没有其他任务，显示空状态
          activeTasksList.innerHTML = `
            <div class="empty-tasks text-center py-4">
              <i class="bi bi-inbox text-muted" style="font-size: 2rem;"></i>
              <p class="text-muted mt-2 mb-0">当前暂无下载任务</p>
            </div>
          `;
        }
        
        loadHistory(); // 刷新历史记录
        showToast('下载完成', 'success');
        return;
      }

      // 计算总大小（MB）
      const totalSizeMB = progress.total ? (progress.total / 1024 / 1024).toFixed(2) : '未知';
      
      // 计算预计完成时间
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
      let percent;
      if (progress.total > 0) {
        // 如果有总大小，计算百分比
        percent = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
      } else {
        // 如果没有总大小，显示已下载大小
        percent = 0;
      }

      // 更新进度条（确保从0开始）
      if (!progressBar.style.width || progressBar.style.width === '100%') {
        progressBar.style.width = '0%';
      }
      progressBar.style.width = `${percent}%`;
      progressBar.setAttribute('aria-valuenow', percent);
      
      // 更新其他信息
      totalSizeSpan.textContent = `${totalSizeMB}MB`;
      etaSpan.textContent = eta;
      speedSpan.textContent = `${progress.speed} MB/s`;
      percentSpan.textContent = progress.total > 0 ? 
        `${percent}%` : 
        `${(progress.loaded / 1024 / 1024).toFixed(2)} MB`;
    } catch (error) {
      console.error('获取进度失败:', error);
      clearInterval(intervalId);
      showToast('获取进度失败', 'error');
    }
  }, 500);
  return intervalId; // 返回定时器 ID 供外部管理
}

// 加载下载历史（核心）
async function loadHistory() {
  try {
    const response = await fetch('/history');
    const history = await response.json();
    
    if (history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-history">
          <i class="bi bi-inbox"></i>
          <p>暂无下载记录</p>
        </div>
      `;
      return;
    }

    const statusMap = { 
      downloading: '下载中', 
      completed: '下载完成', 
      failed: '下载失败', 
      cancelled: '已取消', 
      not_found: '未找到' 
    };

    // 使用 DocumentFragment 提高性能
    const fragment = document.createDocumentFragment();
    
    history.forEach(item => {
      const historyItem = document.createElement('div');
      historyItem.className = 'history-item';
      historyItem.innerHTML = `
        <div class="history-info">
          <p class="filename">
            <i class="bi bi-file-earmark"></i>
            ${item.filename}
          </p>
          <p>
            <i class="bi bi-hdd"></i>
            文件大小：${item.size || '未知'}MB
          </p>
          <p>
            <i class="bi bi-clock-history"></i>
            时间：${new Date(item.timestamp).toLocaleString()}
          </p>
          <p>
            <i class="bi bi-link-45deg"></i>
            原地址：${item.url}
          </p>
          <p class="status ${item.status}">
            <i class="bi bi-${item.status === 'completed' ? 'check-circle' : 
                            item.status === 'failed' ? 'x-circle' : 
                            'arrow-repeat'}"></i>
            ${statusMap[item.status] || item.status}
          </p>
        </div>
        <div class="history-actions">
          ${item.status === 'completed' ? 
            `<a href="/download-file/${encodeURIComponent(item.filename)}" class="download-link">
              <i class="bi bi-download"></i>
              下载到本地
            </a>` : 
            ''}
          <button class="delete-btn" data-id="${item.id}">
            <i class="bi bi-trash"></i>
            删除文件
          </button>
        </div>
      `;
      fragment.appendChild(historyItem);
    });

    // 清空并添加新内容
    historyList.innerHTML = '';
    historyList.appendChild(fragment);

    // 移除旧的事件监听器
    const oldHandler = historyList.getAttribute('data-delete-handler');
    if (oldHandler) {
      historyList.removeEventListener('click', window[oldHandler]);
    }

    // 创建新的事件处理函数
    const handlerName = 'deleteHandler_' + Date.now();
    window[handlerName] = async (e) => {
      const deleteBtn = e.target.closest('.delete-btn');
      if (!deleteBtn) return;

      const taskId = deleteBtn.dataset.id;
      const deleteModal = document.getElementById('deleteModal');
      
      // 获取或创建模态框实例
      let modal = bootstrap.Modal.getInstance(deleteModal);
      if (!modal) {
        modal = new bootstrap.Modal(deleteModal);
      }

      // 移除旧的事件监听器
      const oldConfirmBtn = document.getElementById('deleteModalConfirm');
      const newConfirmBtn = oldConfirmBtn.cloneNode(true);
      oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
      
      // 绑定新的确认事件
      newConfirmBtn.addEventListener('click', async () => {
        try {
          const response = await fetch(`/delete-record/${taskId}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('删除失败');
          
          // 先关闭模态框
          modal.hide();
          
          // 等待模态框完全关闭后再刷新历史记录
          setTimeout(() => {
            loadHistory();
            showToast('删除成功', 'success');
          }, 150);
        } catch (error) {
          showToast(`删除失败：${error.message}`, 'error');
          modal.hide();
        }
      });

      // 显示模态框
      modal.show();
    };

    // 保存事件处理函数的引用
    historyList.setAttribute('data-delete-handler', handlerName);
    historyList.addEventListener('click', window[handlerName]);
  } catch (error) {
    console.error('加载历史记录失败:', error);
    showToast('加载历史记录失败', 'error');
  }
}

// 取消任务逻辑（核心）
function bindCancelTaskEvent(taskId, cancelBtn) {
  cancelBtn.addEventListener('click', async () => {
    const cancelModal = document.getElementById('cancelModal');
    const modal = new bootstrap.Modal(cancelModal);
    modal.show();

    // 确认取消逻辑
    const confirmCancel = async () => {
      try {
        const response = await fetch(`/cancel-download/${taskId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('取消失败');
        
        // 清理前端状态
        const task = activeTasks.get(taskId);
        if (task) {
          clearInterval(task.intervalId);
          activeTasks.delete(taskId);
          task.domElement.remove();
          
          // 如果删除后没有任务了，显示空状态
          if (activeTasks.size === 0) {
            activeTasksList.innerHTML = `
              <div class="empty-tasks text-center py-4">
                <i class="bi bi-inbox text-muted" style="font-size: 2rem;"></i>
                <p class="text-muted mt-2 mb-0">当前暂无下载任务</p>
              </div>
            `;
          }
          
          loadHistory();
        }
        
        showToast('任务已取消', 'warning');
      } catch (error) {
        showToast(`取消失败：${error.message}`, 'error');
      }
      modal.hide();
    };

    // 绑定确认按钮事件
    const confirmBtn = document.getElementById('cancelModalConfirm');
    const cancelBtn = document.getElementById('cancelModalCancel');
    
    // 移除旧的事件监听器
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', confirmCancel);
    
    // 绑定取消按钮事件
    cancelBtn.onclick = () => modal.hide();
  });
}

// 创建任务元素（核心）
function createTaskElement(taskId, filename) {
  // 如果是第一个任务，清空任务列表（包括空状态提示）
  if (activeTasks.size === 0) {
    activeTasksList.innerHTML = '';
  }

  const taskElement = document.createElement('div');
  taskElement.className = 'active-task';
  taskElement.innerHTML = `
    <div class="task-header">
      <span class="task-filename">${filename}</span>
      <button class="cancel-btn" data-task-id="${taskId}">
        <i class="bi bi-x-circle me-1"></i>取消
      </button>
    </div>
    <div class="progress-bar">
      <div class="progress" style="width: 0%"></div>
    </div>
    <div class="progress-info">
      <span>已下载：<span class="percent">0%</span></span>
      <span>速度：<span class="speed">0MB/s</span></span>
      <span>预计完成：<span class="eta">未知</span></span>
      <span>总大小：<span class="totalSize">0MB</span></span>
    </div>
  `;

  // 绑定取消按钮事件
  const cancelBtn = taskElement.querySelector('.cancel-btn');
  bindCancelTaskEvent(taskId, cancelBtn);

  return taskElement;
}

// 初始化加载历史记录
loadHistory();

// 初始化显示空状态
if (activeTasks.size === 0) {
  activeTasksList.innerHTML = `
    <div class="empty-tasks text-center py-4">
      <i class="bi bi-inbox text-muted" style="font-size: 2rem;"></i>
      <p class="text-muted mt-2 mb-0">当前暂无下载任务</p>
    </div>
  `;
}