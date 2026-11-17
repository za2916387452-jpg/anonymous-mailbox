const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const loginForm = document.querySelector('#loginForm');
const passwordInput = document.querySelector('#password');
const loginError = document.querySelector('#loginError');
const logoutButton = document.querySelector('#logoutButton');
const messageList = document.querySelector('#messageList');
const statusFilter = document.querySelector('#statusFilter');
const categoryFilter = document.querySelector('#categoryFilter');
const exportForm = document.querySelector('#exportForm');
const exportStartDate = document.querySelector('#exportStartDate');
const exportEndDate = document.querySelector('#exportEndDate');
const exportError = document.querySelector('#exportError');
const publicUrl = document.querySelector('#publicUrl');
const copyUrlButton = document.querySelector('#copyUrlButton');
const totalCount = document.querySelector('#totalCount');
const unreadCount = document.querySelector('#unreadCount');
const weekCount = document.querySelector('#weekCount');

let allMessages = [];

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showLoginError(message = '') {
  loginError.textContent = message;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

function isThisWeek(value) {
  const date = new Date(value);
  const now = new Date();
  const day = now.getDay() || 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1);
  start.setHours(0, 0, 0, 0);
  return date >= start;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function renderStats() {
  totalCount.textContent = allMessages.length;
  unreadCount.textContent = allMessages.filter((item) => !item.read).length;
  weekCount.textContent = allMessages.filter((item) => isThisWeek(item.createdAt)).length;
}

function filteredMessages() {
  return allMessages.filter((item) => {
    const statusMatches = statusFilter.value === 'all'
      || (statusFilter.value === 'unread' && !item.read)
      || (statusFilter.value === 'read' && item.read);
    const categoryMatches = categoryFilter.value === 'all' || categoryFilter.value === item.category;
    return statusMatches && categoryMatches;
  });
}

function renderMessages() {
  const visible = filteredMessages();
  if (!visible.length) {
    messageList.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true">⌁</div>
        <h3>这里还没有符合条件的留言</h3>
        <p>新的匿名留言会出现在这里。</p>
      </div>`;
    return;
  }
  messageList.innerHTML = visible.map((message) => `
    <article class="message-item ${message.read ? 'is-read' : 'is-unread'}" data-id="${message.id}">
      <div class="message-topline">
        <div class="message-tags">
          <span class="category-pill">${escapeHtml(message.category)}</span>
          ${message.read ? '<span class="read-pill">已读</span>' : '<span class="unread-pill">未读</span>'}
        </div>
        <time datetime="${escapeHtml(message.createdAt)}">${formatDate(message.createdAt)}</time>
      </div>
      <p class="message-content">${escapeHtml(message.content).replace(/\n/g, '<br />')}</p>
      <div class="message-actions">
        <button class="text-button mark-button" type="button" data-action="toggle-read">${message.read ? '标为未读' : '标为已读'}</button>
        <button class="text-button danger-button" type="button" data-action="delete">删除留言</button>
      </div>
    </article>`).join('');
}

async function loadDashboard() {
  const [messageData, configData] = await Promise.all([
    request('/api/admin/messages'),
    request('/api/admin/config'),
  ]);
  allMessages = messageData.messages || [];
  publicUrl.textContent = configData.publicUrl || `${window.location.origin}/`;
  renderStats();
  renderMessages();
}

async function enterDashboard() {
  loginView.classList.add('is-hidden');
  dashboardView.classList.remove('is-hidden');
  try {
    await loadDashboard();
  } catch (error) {
    dashboardView.classList.add('is-hidden');
    loginView.classList.remove('is-hidden');
    showLoginError(error.message || '登录状态已失效，请重新登录');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showLoginError('');
  const password = passwordInput.value;
  if (!password) {
    showLoginError('请输入后台密码');
    return;
  }
  const button = loginForm.querySelector('button');
  button.disabled = true;
  button.querySelector('span').textContent = '正在验证…';
  try {
    await request('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    passwordInput.value = '';
    await enterDashboard();
  } catch (error) {
    showLoginError(error.message || '登录失败');
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = '进入查看台';
  }
});

logoutButton.addEventListener('click', async () => {
  await request('/api/admin/logout', { method: 'POST' });
  dashboardView.classList.add('is-hidden');
  loginView.classList.remove('is-hidden');
  passwordInput.focus();
});

statusFilter.addEventListener('change', renderMessages);
categoryFilter.addEventListener('change', renderMessages);

exportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  exportError.textContent = '';
  const start = exportStartDate.value;
  const end = exportEndDate.value;
  if (!start || !end) {
    exportError.textContent = '请选择开始和结束日期';
    return;
  }
  if (start > end) {
    exportError.textContent = '开始日期不能晚于结束日期';
    return;
  }

  const button = exportForm.querySelector('button[type="submit"]');
  button.disabled = true;
  button.querySelector('span').textContent = '正在生成…';
  try {
    const response = await fetch(
      `/api/admin/export?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      { credentials: 'same-origin' },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '导出失败，请稍后重试');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `班级匿名留言_${start}_${end}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    exportError.textContent = error.message || '导出失败，请稍后重试';
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = '导出 CSV';
  }
});

messageList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = event.target.closest('[data-id]');
  const id = item?.dataset.id;
  const message = allMessages.find((entry) => entry.id === id);
  if (!message) return;
  if (button.dataset.action === 'delete') {
    if (!window.confirm('确定删除这条留言吗？删除后无法恢复。')) return;
    await request(`/api/admin/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } else {
    await request(`/api/admin/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: !message.read }),
    });
  }
  await loadDashboard();
});

copyUrlButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(publicUrl.textContent);
  const original = copyUrlButton.textContent;
  copyUrlButton.textContent = '已复制';
  setTimeout(() => { copyUrlButton.textContent = original; }, 1500);
});

request('/api/admin/me').then(enterDashboard).catch(() => passwordInput.focus());
