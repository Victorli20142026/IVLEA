// database.js - PostgreSQL 数据库初始化 (Supabase)
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[数据库] 错误: 未设置 DATABASE_URL 环境变量');
  process.exit(1);
}

// 创建连接池
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

// 初始化数据库表
async function initDb() {
  try {
    // 创建作品表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT DEFAULT '',
        filename TEXT NOT NULL,
        public_id TEXT DEFAULT '',
        mimetype TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        reject_reason TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        reviewed_at TEXT
      );
    `);

    // 创建管理员表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL
      );
    `);

    // 初始化默认管理员账号 V / qyjrUp-0hyhwo-ripzec
    const result = await pool.query('SELECT COUNT(*) as cnt FROM admins');
    if (parseInt(result.rows[0].cnt) === 0) {
      const hash = bcrypt.hashSync('qyjrUp-0hyhwo-ripzec', 10);
      await pool.query(
        'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
        ['V', hash]
      );
      console.log('[数据库] 已创建默认管理员: V / qyjrUp-0hyhwo-ripzec');
    }

    console.log('[数据库] PostgreSQL 连接成功,表已就绪');
  } catch (err) {
    console.error('[数据库] 初始化失败:', err.message);
    process.exit(1);
  }
}

// 导出查询辅助函数
module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDb
};
