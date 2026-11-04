const router = require('express').Router();
const { db, now, getSetting, setSetting, logAction, hashPassword } = require('../db');
const { flash, requireAdmin, LEVELS } = require('../middleware');
const lvl = (v) => (LEVELS[v] ? v : 'member');
const { ROLES } = require('../helpers');
const notify = require('../notify');
const { removeLocal } = require('../uploads');

router.use(requireAdmin);
router.use((req, res, next) => { res.locals.adminNav = req.path; next(); });

router.get('/', (req, res) => {
  const day = now() - 24 * 3600e3;
  const s = db.prepare(`SELECT
      (SELECT COUNT(*) FROM users) users,
      (SELECT COUNT(*) FROM users WHERE created_at > ?) users24,
      (SELECT COUNT(*) FROM threads) threads,
      (SELECT COUNT(*) FROM posts) posts,
      (SELECT COUNT(*) FROM posts WHERE created_at > ?) posts24,
      (SELECT COUNT(*) FROM users WHERE last_seen > ?) online,
      (SELECT COUNT(*) FROM users WHERE is_banned = 1) banned`).get(day, day, now() - 15 * 60e3);
  const newUsers = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 6').all();
  const log = db.prepare('SELECT l.*, u.username FROM mod_log l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 8').all();
  res.render('admin/dashboard', { title: 'Yönetim paneli', s, newUsers, log });
});

router.get('/nodes', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY position, id').all();
  const forums = db.prepare(`SELECT f.*, (SELECT COUNT(*) FROM threads WHERE forum_id = f.id) AS threads FROM forums f ORDER BY position, id`).all();
  categories.forEach((c) => (c.forums = forums.filter((f) => f.category_id === c.id)));
  res.render('admin/nodes', { title: 'Forum yapısı', categories, LEVELS });
});

router.post('/nodes', (req, res) => {
  const b = req.body;
  const pos = parseInt(b.position) || 0;
  switch (b.action) {
    case 'cat_add':
      if (b.title?.trim()) { db.prepare('INSERT INTO categories(title, position) VALUES(?, ?)').run(b.title.trim(), pos); logAction(req.user.id, `Kategori eklendi: ${b.title.trim()}`); }
      break;
    case 'cat_save':
      db.prepare('UPDATE categories SET title = ?, position = ? WHERE id = ?').run(b.title.trim(), pos, b.id);
      break;
    case 'cat_delete':
      db.prepare('DELETE FROM categories WHERE id = ?').run(b.id);
      logAction(req.user.id, `Kategori silindi (#${b.id})`);
      break;
    case 'forum_add':
      if (b.title?.trim()) {
        db.prepare('INSERT INTO forums(category_id, title, description, icon, position, thread_level, reply_level) VALUES(?, ?, ?, ?, ?, ?, ?)')
          .run(b.category_id, b.title.trim(), b.description || '', b.icon || 'chat', pos, lvl(b.thread_level), lvl(b.reply_level));
        logAction(req.user.id, `Forum eklendi: ${b.title.trim()}`);
      }
      break;
    case 'forum_save':
      db.prepare('UPDATE forums SET title = ?, description = ?, icon = ?, position = ?, category_id = ?, thread_level = ?, reply_level = ? WHERE id = ?')
        .run(b.title.trim(), b.description || '', b.icon || 'chat', pos, b.category_id, lvl(b.thread_level), lvl(b.reply_level), b.id);
      break;
    case 'forum_delete':
      db.prepare('DELETE FROM forums WHERE id = ?').run(b.id);
      logAction(req.user.id, `Forum silindi (#${b.id})`);
      break;
  }
  flash(req, 'ok', 'Forum yapısı güncellendi.');
  res.redirect('/admin/nodes');
});

router.get('/prefixes', (req, res) => {
  const prefixes = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM threads WHERE prefix_id = p.id) AS used FROM prefixes p ORDER BY position, id`).all();
  res.render('admin/prefixes', { title: 'Konu önekleri', prefixes });
});

router.post('/prefixes', (req, res) => {
  const b = req.body;
  const label = String(b.label || '').trim().slice(0, 24);
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#6b7280';
  const pos = parseInt(b.position) || 0;
  if (b.action === 'add' && label) {
    db.prepare('INSERT INTO prefixes(label, color, position) VALUES(?, ?, ?)').run(label, color, pos);
    logAction(req.user.id, `Önek eklendi: ${label}`);
  } else if (b.action === 'save' && label) {
    db.prepare('UPDATE prefixes SET label = ?, color = ?, position = ? WHERE id = ?').run(label, color, pos, b.id);
  } else if (b.action === 'delete') {
    db.prepare('UPDATE threads SET prefix_id = NULL WHERE prefix_id = ?').run(b.id);
    db.prepare('DELETE FROM prefixes WHERE id = ?').run(b.id);
    logAction(req.user.id, `Önek silindi (#${b.id})`);
  }
  flash(req, 'ok', 'Önekler güncellendi.');
  res.redirect('/admin/prefixes');
});

router.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id = u.id) posts FROM users u
      WHERE u.username LIKE ? ORDER BY u.id DESC LIMIT 100`).all(`%${q}%`);
  res.render('admin/users', { title: 'Kullanıcılar', users, q });
});

router.get('/users/:id', (req, res, next) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member) return next();
  res.render('admin/user_edit', { title: `Düzenle: ${member.username}`, member, roles: ROLES });
});

router.post('/users/:id', (req, res, next) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member) return next();
  const b = req.body;
  const self = member.id === req.user.id;

  if (b.action === 'delete') {
    if (self) { flash(req, 'error', 'Kendi hesabını silemezsin.'); return res.redirect(`/admin/users/${member.id}`); }
    db.prepare('DELETE FROM reactions WHERE user_id = ?').run(member.id);
    db.prepare('DELETE FROM threads WHERE user_id = ?').run(member.id);
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(member.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(member.id);
    removeLocal(member.avatar_url);
    removeLocal(member.banner_url);
    logAction(req.user.id, `Kullanıcı silindi: ${member.username}`);
    flash(req, 'ok', `${member.username} silindi.`);
    return res.redirect('/admin/users');
  }

  if (b.action === 'remove_avatar' || b.action === 'remove_banner') {
    const col = b.action === 'remove_avatar' ? 'avatar_url' : 'banner_url';
    removeLocal(member[col]);
    db.prepare(`UPDATE users SET ${col} = NULL WHERE id = ?`).run(member.id);
    logAction(req.user.id, `${member.username}: ${col === 'avatar_url' ? 'avatar' : 'kapak görseli'} kaldırıldı`);
    flash(req, 'ok', 'Görsel kaldırıldı.');
    return res.redirect(`/admin/users/${member.id}`);
  }

  const role = ROLES[b.role] ? b.role : member.role;
  if (self && role !== 'admin') { flash(req, 'error', 'Kendi yönetici yetkini kaldıramazsın.'); return res.redirect(`/admin/users/${member.id}`); }
  const banned = self ? 0 : (b.is_banned ? 1 : 0);
  const color = /^#[0-9a-f]{6}$/i.test(b.name_color || '') && b.use_color ? b.name_color : null;
  db.prepare('UPDATE users SET role = ?, title = ?, name_color = ?, is_banned = ? WHERE id = ?')
    .run(role, String(b.title || '').slice(0, 40) || null, color, banned, member.id);
  if (b.new_password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.new_password), member.id);

  const changes = [];
  if (role !== member.role) {
    changes.push(`rol → ${ROLES[role].label}`);
    notify.onRoleChange({ userId: member.id, actorId: req.user.id, roleLabel: ROLES[role].label });
  }
  if (banned !== member.is_banned) changes.push(banned ? 'yasaklandı' : 'yasak kaldırıldı');
  if (b.new_password) changes.push('şifre sıfırlandı');
  if (changes.length) logAction(req.user.id, `${member.username}: ${changes.join(', ')}`);

  flash(req, 'ok', 'Kullanıcı güncellendi.');
  res.redirect(`/admin/users/${member.id}`);
});

router.get('/settings', (req, res) => {
  res.render('admin/settings', { title: 'Site ayarları' });
});

router.post('/settings', (req, res) => {
  setSetting('site_name', String(req.body.site_name || 'Forum').slice(0, 40));
  setSetting('site_tagline', String(req.body.site_tagline || '').slice(0, 120));
  setSetting('announcement', String(req.body.announcement || '').slice(0, 300));
  logAction(req.user.id, 'Site ayarları güncellendi');
  flash(req, 'ok', 'Ayarlar kaydedildi.');
  res.redirect('/admin/settings');
});

router.get('/log', (req, res) => {
  const log = db.prepare('SELECT l.*, u.username FROM mod_log l JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200').all();
  res.render('admin/log', { title: 'İşlem kayıtları', log });
});

module.exports = router;
