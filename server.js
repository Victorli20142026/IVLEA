// server.js - 摄影画廊后端 (Cloudinary + Supabase)
const express = require('express');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'photo-gallery-secret-key-2024';

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

// ---- multer 上传配置 (使用内存存储,上传到 Cloudinary) ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/GIF/WEBP/BMP 格式的图片'));
  }
});

// 上传文件到 Cloudinary
function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'photo-gallery' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
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

// 上传作品(任何人可访问)
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择要上传的图片' });

  const { title, author, description } = req.body;
  if (!title || !author) {
    return res.status(400).json({ error: '标题和作者不能为空' });
  }

  try {
    // 上传到 Cloudinary
    const uploadResult = await uploadToCloudinary(req.file.buffer);
    const photoUrl = uploadResult.secure_url;
    const publicId = uploadResult.public_id;

    const createdAt = new Date().toISOString();

    // 存入数据库
    const result = await db.query(
      `INSERT INTO photos (title, author, description, filename, public_id, mimetype, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id`,
      [title.trim(), author.trim(), (description || '').trim(), req.file.originalname, publicId, req.file.mimetype, createdAt]
    );

    res.json({
      success: true,
      message: '上传成功,等待管理员审核',
      photo: {
        id: result.rows[0].id,
        title: title.trim(),
        author: author.trim(),
        url: photoUrl,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('[上传] 失败:', err);
    res.status(500).json({ error: '上传失败,请重试' });
  }
});

// 获取已审核通过的作品列表(画廊展示)
app.get('/api/photos', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, title, author, description, filename, public_id, status, created_at
       FROM photos
       WHERE status = 'approved'
       ORDER BY created_at DESC`
    );

    // 用 Cloudinary URL (需要从 public_id 构造,或直接存 URL)
    // 这里我们直接存了 public_id,需要转成 URL
    const list = result.rows.map(p => ({
      ...p,
      url: cloudinary.url(p.public_id, { secure: true })
    }));
    res.json({ photos: list });
  } catch (err) {
    console.error('[获取作品] 失败:', err);
    res.status(500).json({ error: '加载失败' });
  }
});

// ==================== 管理员 API ====================

// 管理员登录
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  try {
    const result = await db.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];
    if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, username: admin.username });
  } catch (err) {
    console.error('[登录] 失败:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

// 获取所有作品(含待审核/已拒绝),需登录
app.get('/api/admin/photos', authMiddleware, async (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT * FROM photos';
  const params = [];
  if (status) {
    sql += ' WHERE status = $1';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';

  try {
    const result = await db.query(sql, params);
    const photos = result.rows.map(p => ({
      ...p,
      url: cloudinary.url(p.public_id, { secure: true })
    }));
    res.json({ photos });
  } catch (err) {
    console.error('[获取管理列表] 失败:', err);
    res.status(500).json({ error: '加载失败' });
  }
});

// 审核通过
app.post('/api/admin/photos/:id/approve', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const check = await db.query('SELECT * FROM photos WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '作品不存在' });

    await db.query(
      "UPDATE photos SET status = 'approved', reviewed_at = $1, reject_reason = '' WHERE id = $2",
      [new Date().toISOString(), id]
    );
    res.json({ success: true, message: '已通过审核' });
  } catch (err) {
    console.error('[审核通过] 失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// 审核拒绝
app.post('/api/admin/photos/:id/reject', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  const { reason } = req.body;
  try {
    const check = await db.query('SELECT * FROM photos WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '作品不存在' });

    await db.query(
      "UPDATE photos SET status = 'rejected', reviewed_at = $1, reject_reason = $2 WHERE id = $3",
      [new Date().toISOString(), reason || '', id]
    );
    res.json({ success: true, message: '已拒绝该作品' });
  } catch (err) {
    console.error('[审核拒绝] 失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// 删除作品(同时删除 Cloudinary 上的图片)
app.delete('/api/admin/photos/:id', authMiddleware, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const check = await db.query('SELECT * FROM photos WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: '作品不存在' });

    const photo = check.rows[0];

    // 从 Cloudinary 删除图片
    if (photo.public_id) {
      try {
        await cloudinary.uploader.destroy(photo.public_id);
      } catch (e) {
        console.error('[删除 Cloudinary 图片] 失败:', e.message);
      }
    }

    // 从数据库删除
    await db.query('DELETE FROM photos WHERE id = $1', [id]);
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

// 启动服务 (先初始化数据库)
db.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`摄影画廊服务已启动: http://localhost:${PORT}`);
    console.log(`画廊首页: http://localhost:${PORT}/`);
    console.log(`上传页面: http://localhost:${PORT}/upload.html`);
    console.log(`管理后台: http://localhost:${PORT}/admin.html`);
  });
});
