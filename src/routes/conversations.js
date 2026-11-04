const router = require('express').Router();
const { db, now } = require('../db');
const { flash, requireLogin } = require('../middleware');
const conv = require('../conversations');

const MAX_RECIPIENTS = 5;
const PER_PAGE = 25;

router.use(requireLogin);

function resolveRecipients(raw, selfId) {
  const names = [...new Set(String(raw || '').split(/[,\s]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean))];
  const found = [], missing = [];
  for (const n of names) {
    const u = db.prepare('SELECT id, username, is_banned FROM users WHERE username = ?').get(n);
    if (!u || u.is_banned) missing.push(n);
    else if (u.id !== selfId && !found.some((f) => f.id === u.id)) found.push(u);
  }
  return { found, missing };
}

router.get('/', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM conversation_users WHERE user_id = ? AND has_left = 0').get(req.user.id).c;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page) || 1));
  const items = conv.listFor(req.user.id, PER_PAGE, (page - 1) * PER_PAGE);
  res.render('conversations/list', { title: 'Özel mesajlar', items, page, pages });
});

router.get('/new', (req, res) => {
  res.render('conversations/new', { title: 'Yeni mesaj', error: null, form: { to: req.query.to || '', title: '', body: '' } });
});

router.post('/new', (req, res) => {
  const form = { to: String(req.body.to || ''), title: String(req.body.title || '').trim(), body: String(req.body.body || '').trim() };
  const { found, missing } = resolveRecipients(form.to, req.user.id);
  let error = null;
  if (missing.length) error = `Bu kullanıcılar bulunamadı: ${missing.join(', ')}`;
  else if (!found.length) error = 'En az bir alıcı yazmalısın (kendine mesaj gönderemezsin).';
  else if (found.length > MAX_RECIPIENTS) error = `Bir sohbete en fazla ${MAX_RECIPIENTS} kişi ekleyebilirsin.`;
  else if (form.title.length < 2 || form.title.length > 100) error = 'Konu başlığı 2-100 karakter olmalı.';
  else if (form.body.length < 1) error = 'Mesaj boş olamaz.';
  if (error) return res.status(400).render('conversations/new', { title: 'Yeni mesaj', error, form });

  const t = now();
  const cid = Number(db.prepare('INSERT INTO conversations(title, starter_id, created_at, last_message_at) VALUES(?, ?, ?, ?)')
    .run(form.title, req.user.id, t, t).lastInsertRowid);
  const addUser = db.prepare('INSERT INTO conversation_users(conversation_id, user_id, last_read_at) VALUES(?, ?, ?)');
  addUser.run(cid, req.user.id, t);
  for (const u of found) addUser.run(cid, u.id, 0);
  db.prepare('INSERT INTO conversation_messages(conversation_id, user_id, body, created_at) VALUES(?, ?, ?, ?)').run(cid, req.user.id, form.body, t);
  res.redirect(`/conversations/${cid}`);
});

function load(req, res, next) {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
  const m = c && conv.membership(c.id, req.user.id);
  if (!c || !m) return res.status(404).render('error', { title: 'Sohbet bulunamadı', message: 'Bu sohbet yok ya da katılımcısı değilsin.' });
  req.conv = c; req.member = m;
  next();
}

router.get('/:id', load, (req, res) => {
  const c = req.conv;
  const total = db.prepare('SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?').get(c.id).n;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = req.query.page === undefined || req.query.page === 'last' ? pages : Math.min(pages, Math.max(1, parseInt(req.query.page) || 1));
  const messages = db.prepare(`SELECT m.*, u.id AS uid, u.username, u.avatar_url, u.name_color, u.role, u.title AS utitle
      FROM conversation_messages m JOIN users u ON u.id = m.user_id
      WHERE m.conversation_id = ? ORDER BY m.id LIMIT ? OFFSET ?`).all(c.id, PER_PAGE, (page - 1) * PER_PAGE);
  const lastRead = req.member.last_read_at;
  db.prepare('UPDATE conversation_users SET last_read_at = ?, has_left = 0 WHERE conversation_id = ? AND user_id = ?').run(now(), c.id, req.user.id);
  res.render('conversations/view', {
    title: c.title, c, messages, lastRead, page, pages,
    people: conv.participants(c.id),
    isStarter: c.starter_id === req.user.id,
  });
});

router.post('/:id/reply', load, (req, res) => {
  const body = String(req.body.body || '').trim();
  if (!body) { flash(req, 'error', 'Mesaj boş olamaz.'); return res.redirect(`/conversations/${req.conv.id}`); }
  const t = now();
  const mid = db.prepare('INSERT INTO conversation_messages(conversation_id, user_id, body, created_at) VALUES(?, ?, ?, ?)').run(req.conv.id, req.user.id, body, t).lastInsertRowid;
  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, req.conv.id);
  db.prepare('UPDATE conversation_users SET has_left = 0 WHERE conversation_id = ?').run(req.conv.id);
  db.prepare('UPDATE conversation_users SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(t, req.conv.id, req.user.id);
  res.redirect(`/conversations/${req.conv.id}?page=last#msg-${mid}`);
});

router.post('/:id/invite', load, (req, res) => {
  if (req.conv.starter_id !== req.user.id) { flash(req, 'error', 'Sadece sohbeti başlatan kişi davet edebilir.'); return res.redirect(`/conversations/${req.conv.id}`); }
  const { found, missing } = resolveRecipients(req.body.to, req.user.id);
  const current = conv.participants(req.conv.id);
  const fresh = found.filter((u) => !current.some((p) => p.id === u.id));
  if (missing.length) flash(req, 'error', `Bulunamadı: ${missing.join(', ')}`);
  else if (current.length + fresh.length > MAX_RECIPIENTS + 1) flash(req, 'error', `Bir sohbette en fazla ${MAX_RECIPIENTS + 1} kişi olabilir.`);
  else if (!fresh.length) flash(req, 'info', 'Eklenecek yeni kişi yok.');
  else {
    const add = db.prepare('INSERT INTO conversation_users(conversation_id, user_id, last_read_at) VALUES(?, ?, 0)');
    fresh.forEach((u) => add.run(req.conv.id, u.id));
    flash(req, 'ok', `${fresh.map((u) => u.username).join(', ')} sohbete eklendi.`);
  }
  res.redirect(`/conversations/${req.conv.id}`);
});

router.post('/:id/leave', load, (req, res) => {
  db.prepare('UPDATE conversation_users SET has_left = 1 WHERE conversation_id = ? AND user_id = ?').run(req.conv.id, req.user.id);
  const active = db.prepare('SELECT COUNT(*) c FROM conversation_users WHERE conversation_id = ? AND has_left = 0').get(req.conv.id).c;
  if (!active) db.prepare('DELETE FROM conversations WHERE id = ?').run(req.conv.id);
  flash(req, 'ok', 'Sohbetten ayrıldın. Biri yeni mesaj yazarsa tekrar listende görünür.');
  res.redirect('/conversations');
});

module.exports = router;
