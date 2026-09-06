// admin.js - 管理员审核页面
const TOKEN_KEY = 'gallery_admin_token';
let currentStatus = 'pending';

// 检查登录状态
function checkAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('adminView').classList.remove('hidden');
    loadPhotos();
  }
}

// 登录
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem(TOKEN_KEY, data.token);
      document.getElementById('loginView').classList.add('hidden');
      document.getElementById('adminView').classList.remove('hidden');
      loadPhotos();
    } else {
      showAlert(data.error || '登录失败', 'error');
    }
  } catch {
    showAlert('网络错误', 'error');
  }
});

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  document.getElementById('adminView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
}

// 获取 token 请求头
function authHeaders() {
  return { 'Authorization': 'Bearer ' + localStorage.getItem(TOKEN_KEY) };
}

// 切换标签
document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentStatus = tab.dataset.status;
  renderList();
});

let allPhotos = [];

async function loadPhotos() {
  try {
    const res = await fetch('/api/admin/photos', { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    allPhotos = data.photos || [];

    // 更新计数
    document.getElementById('cnt-pending').textContent = allPhotos.filter(p => p.status === 'pending').length;
    document.getElementById('cnt-approved').textContent = allPhotos.filter(p => p.status === 'approved').length;
    document.getElementById('cnt-rejected').textContent = allPhotos.filter(p => p.status === 'rejected').length;

    renderList();
  } catch {
    showAlert('加载失败', 'error');
  }
}

function renderList() {
  const list = document.getElementById('list');
  const filtered = allPhotos.filter(p => p.status === currentStatus);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="icon">📭</div><p>暂无作品</p></div>';
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div class="review-card">
      <img class="thumb" src="${p.url}" alt="${escapeHtml(p.title)}" onclick="openLightbox('${p.url}')">
      <div class="content">
        <div class="title">
          ${escapeHtml(p.title)}
          <span class="badge badge-${p.status}">${statusText(p.status)}</span>
        </div>
        <div class="meta">作者:${escapeHtml(p.author)} · ${formatDate(p.created_at)}</div>
        ${p.description ? `<div class="desc">${escapeHtml(p.description)}</div>` : ''}
        ${p.reject_reason ? `<div class="desc" style="color:var(--danger);">拒绝原因:${escapeHtml(p.reject_reason)}</div>` : ''}
        <div class="actions">
          ${p.status === 'pending' ? `
            <button class="btn btn-success" onclick="approve(${p.id})">✓ 通过</button>
            <button class="btn btn-danger" onclick="reject(${p.id})">✕ 拒绝</button>
          ` : ''}
          ${p.status === 'rejected' ? `
            <button class="btn btn-success" onclick="approve(${p.id})">重新通过</button>
          ` : ''}
          ${p.status === 'approved' ? `
            <button class="btn btn-ghost" onclick="reject(${p.id})">撤回拒绝</button>
          ` : ''}
          <button class="btn btn-ghost" onclick="del(${p.id})">🗑 删除</button>
        </div>
      </div>
    </div>
  `).join('');
}

function statusText(s) {
  return { pending: '待审核', approved: '已通过', rejected: '已拒绝' }[s] || s;
}

async function approve(id) {
  const res = await fetch(`/api/admin/photos/${id}/approve`, {
    method: 'POST', headers: authHeaders()
  });
  if (res.ok) loadPhotos();
  else alert('操作失败');
}

async function reject(id) {
  const reason = prompt('请输入拒绝原因(可选):');
  if (reason === null) return; // 取消
  const res = await fetch(`/api/admin/photos/${id}/reject`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  if (res.ok) loadPhotos();
  else alert('操作失败');
}

async function del(id) {
  if (!confirm('确定删除该作品?图片文件将被永久删除。')) return;
  const res = await fetch(`/api/admin/photos/${id}`, {
    method: 'DELETE', headers: authHeaders()
  });
  if (res.ok) loadPhotos();
  else alert('删除失败');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function showAlert(msg, type) {
  document.getElementById('alert').innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('active');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') closeLightbox();
});

checkAuth();
