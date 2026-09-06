// server.js - 摄影画廊后端
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'photo-gallery-secret-key-2024';

// 确保 uploads 目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 关键:uploads 目录映射为公开静态资源,前缀 /uploads 与上传返回 URL 一致
// 根据经验:图片用于公开展示,使用公开静态 URL + 放行,不走鉴权链路
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

// 前端静态文件
app.use(express.static(path.join(__dirname, 'public')));

// ---- multer 上传配置 ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // 用时间戳 + 随机串生成唯一文件名,保留原扩展名
    const ext = path.extname(file.originalname) || '.jpg';
    const unique = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    cb(null, unique + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG/PNG/GIF/WEBP/BMP 格式的图片'));
  }
});

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
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择要上传的图片' });

  const { title, author, description } = req.body;
  if (!title || !author) {
    // 已保存的文件需要清理
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: '标题和作者不能为空' });
  }

  const createdAt = new Date().toISOString();
  // 返回的 URL 前缀 /uploads 与静态映射完全一致,避免被拼到 /api 下
  const photoUrl = `/uploads/${req.file.filename}`;

  const stmt = db.prepare(`
    INSERT INTO photos (title, author, description, filename, mimetype, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);
  const result = stmt.run(title.trim(), author.trim(), (description || '').trim(), req.file.filename, req.file.mimetype, createdAt);

  res.json({
    success: true,
    message: '上传成功,等待管理员审核',
    photo: {
      id: result.lastInsertRowid,
      title: title.trim(),
      author: author.trim(),
      url: photoUrl,
      status: 'pending'
    }
  });
});

// 获取已审核通过的作品列表(画廊展示)
app.get('/api/photos', (req, res) => {
  const photos = db.prepare(`
    SELECT id, title, author, description, filename, status, created_at
    FROM photos
    WHERE status = 'approved'
    ORDER BY created_at DESC
  `).all();

  // 统一返回 /uploads/ 前缀的公开 URL
  const list = photos.map(p => ({
    ...p,
    url: `/uploads/${p.filename}`
  }));
  res.json({ photos: list });
});

// ==================== 管理员 API ====================

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, username: admin.username });
});

// 获取所有作品(含待审核/已拒绝),需登录
app.get('/api/admin/photos', authMiddleware, (req, res) => {
  const status = req.query.status; // 可选过滤: pending / approved / rejected
  let sql = 'SELECT * FROM photos';
  const params = [];
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  const photos = db.prepare(sql).all(...params).map(p => ({
    ...p,
    url: `/uploads/${p.filename}`
  }));
  res.json({ photos });
});

// 审核通过
app.post('/api/admin/photos/:id/approve', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return res.status(404).json({ error: '作品不存在' });

  db.prepare("UPDATE photos SET status = 'approved', reviewed_at = ?, reject_reason = '' WHERE id = ?")
    .run(new Date().toISOString(), id);
  res.json({ success: true, message: '已通过审核' });
});

// 审核拒绝
app.post('/api/admin/photos/:id/reject', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const { reason } = req.body;
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return res.status(404).json({ error: '作品不存在' });

  db.prepare("UPDATE photos SET status = 'rejected', reviewed_at = ?, reject_reason = ? WHERE id = ?")
    .run(new Date().toISOString(), reason || '', id);
  res.json({ success: true, message: '已拒绝该作品' });
});

// 删除作品(同时删除文件)
app.delete('/api/admin/photos/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
  if (!photo) return res.status(404).json({ error: '作品不存在' });

  // 删除文件
  const filePath = path.join(uploadsDir, photo.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  res.json({ success: true, message: '作品已删除' });
});

// ==================== 错误处理 ====================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片大小不能超过 20MB' });
  }
  res.status(400).json({ error: err.message || '上传失败' });
});

// 启动
app.listen(PORT, () => {
  console.log(`摄影画廊服务已启动: http://localhost:${PORT}`);
  console.log(`画廊首页: http://localhost:${PORT}/`);
  console.log(`上传页面: http://localhost:${PORT}/upload.html`);
  console.log(`管理后台: http://localhost:${PORT}/admin.html`);
});
