const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'forum.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',        -- admin | moderator | member
  title TEXT,                                 -- kullanıcı ünvanı (ör. "Yönetici")
  name_color TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  about TEXT,
  location TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS forums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  staff_only_post INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forum_id INTEGER NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER
);

CREATE TABLE IF NOT EXISTS reactions (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- bildirimi alan
  actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,          -- işlemi yapan
  type TEXT NOT NULL,          -- reply | quote | mention | reaction | role | ban
  thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  extra TEXT,
  count INTEGER NOT NULL DEFAULT 1,  -- aynı konuya gelen okunmamış cevaplar tek bildirimde toplanır
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, id);

-- Özel mesajlar (sohbetler). Bir sohbette birden fazla katılımcı olabilir.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  starter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_users (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  has_left INTEGER NOT NULL DEFAULT 0,   -- ayrılan kişi yeni mesaj gelince sohbete geri döner
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cu_user ON conversation_users(user_id, has_left);
CREATE INDEX IF NOT EXISTS idx_cm_conv ON conversation_messages(conversation_id, id);

CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_threads_forum ON threads(forum_id);

-- Konu önekleri: [Reklam] [Tanıtım] [Paket] ...
CREATE TABLE IF NOT EXISTS prefixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6f6d68',
  position INTEGER NOT NULL DEFAULT 0
);
`);

function addColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
addColumn('threads', 'prefix_id', 'INTEGER REFERENCES prefixes(id) ON DELETE SET NULL');
addColumn('threads', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');

const hadLevels = db.prepare('PRAGMA table_info(forums)').all().some((c) => c.name === 'thread_level');
addColumn('forums', 'thread_level', "TEXT NOT NULL DEFAULT 'member'");
addColumn('forums', 'reply_level', "TEXT NOT NULL DEFAULT 'member'");
if (!hadLevels) {
  db.exec("UPDATE forums SET thread_level = 'staff' WHERE staff_only_post = 1");
  db.exec(`UPDATE forums SET thread_level = 'admin', reply_level = 'admin'
           WHERE title IN ('Duyurular', 'Kurallar & Rehber')`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

const now = () => Date.now();

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

function logAction(userId, action) {
  db.prepare('INSERT INTO mod_log(user_id, action, created_at) VALUES(?, ?, ?)').run(userId, action, now());
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (getSetting('site_name') === null) {
    setSetting('site_name', 'Forumsitesi');
    setSetting('site_tagline', 'Topluluk, sunucu ve geliştirme üzerine.');
    setSetting('announcement', 'Foruma hoş geldin. Kuralları okumayı unutma.');
  }

  if (!db.prepare('SELECT COUNT(*) c FROM prefixes').get().c) {
    const add = db.prepare('INSERT INTO prefixes(label, color, position) VALUES(?, ?, ?)');
    [
      ['Script', '#4c8dff'], ['Tanıtım', '#8a8f98'], ['Paket', '#a1887f'], ['Paylaşım', '#2fb5c9'],
      ['Reklam', '#f2a516'], ['Kıyafet', '#ff7a45'], ['Soru', '#9b7bff'], ['Çözüldü', '#3fbf7f'],
      ['Yetkili Arıyorum', '#6b7280'], ['Ekip Üyesi Arıyorum', '#6b7280'],
    ].forEach(([l, c], i) => add.run(l, c, i + 1));
  }

  let admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const info = db.prepare(`INSERT INTO users(username, password_hash, role, title, name_color, created_at, last_seen)
      VALUES(?, ?, 'admin', NULL, '#ff4d3d', ?, ?)`).run('admin', hashPassword('admin'), now(), now());
    admin = { id: Number(info.lastInsertRowid) };
  }

  if (count > 0) return;

  const addCat = db.prepare('INSERT INTO categories(title, position) VALUES(?, ?)');
  const addForum = db.prepare('INSERT INTO forums(category_id, title, description, icon, position, thread_level, reply_level) VALUES(?, ?, ?, ?, ?, ?, ?)');

  const c1 = Number(addCat.run('Forum Merkezi', 1).lastInsertRowid);
  const announcements = Number(addForum.run(c1, 'Duyurular', 'Forum yönetiminden resmi duyurular.', 'megaphone', 1, 'admin', 'admin').lastInsertRowid);
  addForum.run(c1, 'Kurallar & Rehber', 'Forum kuralları ve kullanım rehberi.', 'book', 2, 'admin', 'admin');
  addForum.run(c1, 'Öneri & Şikayet', 'Forumla ilgili fikirlerini paylaş.', 'chat', 3, 'member', 'member');

  const c2 = Number(addCat.run('FiveM', 2).lastInsertRowid);
  addForum.run(c2, 'Script Paylaşımı', 'Lua, JS ve C# kaynakları.', 'code', 1, 'member', 'member');
  addForum.run(c2, 'MLO & Harita', 'Interior, mapping ve YMAP paylaşımları.', 'map', 2, 'member', 'member');
  addForum.run(c2, 'Araç & Model', 'Araç paketleri, EUP ve modeller.', 'car', 3, 'member', 'member');
  addForum.run(c2, 'Yardım & Destek', 'Takıldığın yerde sor, cevaplayalım.', 'help', 4, 'member', 'member');

  const c3 = Number(addCat.run('Topluluk', 3).lastInsertRowid);
  addForum.run(c3, 'Sunucu Tanıtımları', 'Sunucunu tanıt, oyuncu bul.', 'server', 1, 'member', 'member');
  addForum.run(c3, 'Sohbet', 'Konu dışı her şey.', 'coffee', 2, 'member', 'member');

  const t = now();
  const th = Number(db.prepare('INSERT INTO threads(forum_id, user_id, title, is_pinned, created_at, last_post_at) VALUES(?, ?, ?, 1, ?, ?)')
    .run(announcements, admin.id, 'Foruma hoş geldiniz!', t, t).lastInsertRowid);
  db.prepare('INSERT INTO posts(thread_id, user_id, body, created_at) VALUES(?, ?, ?, ?)').run(th, admin.id,
    '[b]Forumumuz açıldı![/b]\n\nBurada script, harita, araç paylaşımları yapabilir; sunucunu tanıtabilir ve yardım isteyebilirsin.\n\n[quote]Saygılı ol, paylaştığın içeriğin kaynağını belirt.[/quote]\n\nİyi forumlar.', t);
}
seed();

module.exports = { db, hashPassword, verifyPassword, now, getSetting, setSetting, logAction };
