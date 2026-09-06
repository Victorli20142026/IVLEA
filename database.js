// database.js - SQLite 数据库初始化
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'gallery.db'));

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');

// 创建作品表
db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    description TEXT DEFAULT '',
    filename TEXT NOT NULL,
    mimetype TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / approved / rejected
    reject_reason TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
`);

// 创建管理员表
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );
`);

// 初始化默认管理员账号 V / qyjrUp-0hyhwo-ripzec
const adminCount = db.prepare('SELECT COUNT(*) as cnt FROM admins').get().cnt;
if (adminCount === 0) {
  const hash = bcrypt.hashSync('qyjrUp-0hyhwo-ripzec', 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('V', hash);
  console.log('[数据库] 已创建默认管理员: V / qyjrUp-0hyhwo-ripzec');
}

module.exports = db;
