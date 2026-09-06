// gallery.js - 画廊首页
const galleryEl = document.getElementById('gallery');
const loadingEl = document.getElementById('loading');
const emptyEl = document.getElementById('empty');

async function loadPhotos() {
  loadingEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  galleryEl.innerHTML = '';

  try {
    const res = await fetch('/api/photos');
    const data = await res.json();
    const photos = data.photos || [];

    if (photos.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    photos.forEach(p => {
      const item = document.createElement('div');
      item.className = 'gallery-item';
      item.innerHTML = `
        <img src="${p.url}" alt="${escapeHtml(p.title)}" loading="lazy" onclick="openLightbox('${p.url}')">
        <div class="info">
          <div class="title">${escapeHtml(p.title)}</div>
          <div class="author">📸 ${escapeHtml(p.author)}</div>
        </div>
      `;
      galleryEl.appendChild(item);
    });
  } catch (e) {
    galleryEl.innerHTML = '<div class="empty">加载失败,请刷新重试</div>';
  } finally {
    loadingEl.classList.add('hidden');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function openLightbox(url) {
  document.getElementById('lightbox-img').src = url;
  document.getElementById('lightbox').classList.add('active');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

// 点击灯箱背景关闭
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') closeLightbox();
});

loadPhotos();
