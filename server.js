// server.js - 摄影画廊后端 (仅 Cloudinary,无数据库)
const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'photo-gallery-secret-key-2024';

// 管理员账号 (从环境变量读取,默认 V / qyjrUp-0hyhwo-ripzec)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'V';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'qyjrUp-0hyhwo-ripzec';

// Cloudinary 配置
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error('[Cloudinary] 错误: 未设置 CLOUDINARY_* 环境变量');
  process.exit(1);
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 前端静态文件
app.use(express.static(path.join(__dirname, 'public')));

// ---- multer 上传配置 (内存存储,上传到 Cloudinary) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/GIF/WEBP/BMP 格式的图片'));
  }
});

// 上传文件到 Cloudinary (带元数据)
function uploadToCloudinary(buffer, originalname, context) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'photo-gallery',
        context: context
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
}

// 从 Cloudinary 获取所有图片及其元数据
async function getAllPhotos() {
  const result = await cloudinary.api.resources({
    type: 'upload',
    prefix: 'photo-gallery/',
    context: true,
    metadata: true,
    max_results: 500
  });
  return result.resources.map(r => ({
    id: r.public_id,
    public_id: r.public_id,
    url: r.secure_url,
    created_at: r.created_at,
    ...(r.context && r.context.custom ? r.context.custom : {})
  }));
}

// ---- JWT 鉴权中间件 ----
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期,请重新登录' });
  }
}

// ==================== 公开 API ====================

// 上传作品
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择要上传的图片' });

  const { title, author, description } = req.body;
  if (!title || !author) {
    return res.status(400).json({ error: '标题和作者不能为空' });
  }

  try {
    const context = {
      title: title.trim(),
      author: author.trim(),
      description: (description || '').trim(),
      status: 'pending',
      reject_reason: '',
      filename: req.file.originalname
    };

    const uploadResult = await uploadToCloudinary(req.file.buffer, req.file.originalname, context);

    res.json({
      success: true,
      message: '上传成功,等待管理员审核',
      photo: {
        id: uploadResult.public_id,
        title: title.trim(),
        author: author.trim(),
        url: uploadResult.secure_url,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('[上传] 失败:', err);
    res.status(500).json({ error: '上传失败,请重试' });
  }
});

// 获取已审核通过的作品列表
app.get('/api/photos', async (req, res) => {
  try {
    const photos = await getAllPhotos();
    const approved = photos
      .filter(p => p.status === 'approved')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ photos: approved });
  } catch (err) {
    console.error('[获取作品] 失败:', err);
    res.status(500).json({ error: '加载失败' });
  }
});

// ==================== 管理员 API ====================

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ username: ADMIN_USERNAME }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, username: ADMIN_USERNAME });
});

// 获取所有作品
app.get('/api/admin/photos', authMiddleware, async (req, res) => {
  const status = req.query.status;
  try {
    let photos = await getAllPhotos();
    if (status) photos = photos.filter(p => p.status === status);
    photos.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ photos });
  } catch (err) {
    console.error('[获取管理列表] 失败:', err);
    res.status(500).json({ error: '加载失败' });
  }
});

// 审核通过
app.post('/api/admin/photos/:id/approve', authMiddleware, async (req, res) => {
  const publicId = decodeURIComponent(req.params.id);
  try {
    // 获取当前元数据
    const photos = await getAllPhotos();
    const photo = photos.find(p => p.public_id === publicId);
    if (!photo) return res.status(404).json({ error: '作品不存在' });

    // 更新状态
    await cloudinary.api.update(publicId, {
      context: {
        title: photo.title || '',
        author: photo.author || '',
        description: photo.description || '',
        status: 'approved',
        reject_reason: '',
        filename: photo.filename || ''
      }
    });
    res.json({ success: true, message: '已通过审核' });
  } catch (err) {
    console.error('[审核通过] 失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// 审核拒绝
app.post('/api/admin/photos/:id/reject', authMiddleware, async (req, res) => {
  const publicId = decodeURIComponent(req.params.id);
  const { reason } = req.body;
  try {
    const photos = await getAllPhotos();
    const photo = photos.find(p => p.public_id === publicId);
    if (!photo) return res.status(404).json({ error: '作品不存在' });

    await cloudinary.api.update(publicId, {
      context: {
        title: photo.title || '',
        author: photo.author || '',
        description: photo.description || '',
        status: 'rejected',
        reject_reason: reason || '',
        filename: photo.filename || ''
      }
    });
    res.json({ success: true, message: '已拒绝该作品' });
  } catch (err) {
    console.error('[审核拒绝] 失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// 删除作品
app.delete('/api/admin/photos/:id', authMiddleware, async (req, res) => {
  const publicId = decodeURIComponent(req.params.id);
  try {
    await cloudinary.uploader.destroy(publicId);
    res.json({ success: true, message: '作品已删除' });
  } catch (err) {
    console.error('[删除作品] 失败:', err);
    res.status(500).json({ error: '删除失败' });
  }
});

// ==================== 错误处理 ====================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片大小不能超过 20MB' });
  }
  res.status(400).json({ error: err.message || '上传失败' });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`摄影画廊服务已启动: http://localhost:${PORT}`);
  console.log(`画廊首页: http://localhost:${PORT}/`);
  console.log(`上传页面: http://localhost:${PORT}/upload.html`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html`);
});
