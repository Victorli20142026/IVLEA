// upload.js - 上传页面
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const form = document.getElementById('uploadForm');
const alertEl = document.getElementById('alert');
const submitBtn = document.getElementById('submitBtn');

let selectedFile = null;

// 点击上传区触发文件选择
dropZone.addEventListener('click', () => fileInput.click());

// 拖拽上传
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

// 文件选择
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

function handleFile(file) {
  // 校验类型
  if (!file.type.startsWith('image/')) {
    showAlert('请选择图片文件', 'error');
    return;
  }
  // 校验大小
  if (file.size > 20 * 1024 * 1024) {
    showAlert('图片大小不能超过 20MB', 'error');
    return;
  }
  selectedFile = file;
  // 预览
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function showAlert(msg, type) {
  alertEl.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedFile) {
    showAlert('请先选择要上传的图片', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('photo', selectedFile);
  formData.append('title', document.getElementById('title').value);
  formData.append('author', document.getElementById('author').value);
  formData.append('description', document.getElementById('description').value);

  submitBtn.disabled = true;
  submitBtn.textContent = '上传中...';

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok && data.success) {
      showAlert('上传成功!作品已提交,等待管理员审核通过后将在画廊展示。', 'success');
      form.reset();
      preview.classList.add('hidden');
      selectedFile = null;
    } else {
      showAlert(data.error || '上传失败,请重试', 'error');
    }
  } catch (err) {
    showAlert('网络错误,请重试', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '提交审核';
  }
});
