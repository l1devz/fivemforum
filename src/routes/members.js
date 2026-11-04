const router = require('express').Router();
const { db, hashPassword, verifyPassword, now } = require('../db');
const { flash, requireLogin } = require('../middleware');
const { safeUrl } = require('../helpers');
const notify = require('../notify');
const { upload, saveImage, removeLocal } = require('../uploads');

function profileStats(id) {
  return db.prepare(`SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
      (SELECT COUNT(*) FROM threads WHERE user_id = ?) AS threads,
      (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.user_id = ?) AS score`).get(id, id, id);
}

router.get('/members', (req, res) => {
  const sort = req.query.sort === 'new' ? 'u.id DESC' : 'posts DESC, u.id';
  const members = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS posts,
        (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.user_id = u.id) AS score
      FROM users u ORDER BY ${sort} LIMIT 100`).all();
  const staff = members.filter((m) => m.role !== 'member');
  res.render('members', { title: 'Üyeler', members, staff, sort: req.query.sort === 'new' ? 'new' : 'posts' });
});

router.get('/member/:id', (req, res, next) => {
  const member = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!member) return next();
  const tab = ['posts', 'about'].includes(req.query.tab) ? req.query.tab : 'activity';
  const stats = profileStats(member.id);
  let items = [];
  if (tab === 'activity') {
    items = db.prepare(`SELECT 'post' AS kind, p.id, p.body, p.created_at, t.id AS tid, t.title,
          (p.id = (SELECT MIN(id) FROM posts WHERE thread_id = t.id)) AS is_first
        FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 20`).all(member.id);
  } else if (tab === 'posts') {
    items = db.prepare(`SELECT p.id, p.body, p.created_at, t.id AS tid, t.title, f.title AS forum
        FROM posts p JOIN threads t ON t.id = p.thread_id JOIN forums f ON f.id = t.forum_id
        WHERE p.user_id = ? ORDER BY p.id DESC LIMIT 30`).all(member.id);
  }
  res.render('profile', { title: member.username, member, stats, tab, items });
});

router.get('/u/:name', (req, res, next) => {
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.name);
  if (!u) return next();
  res.redirect(`/member/${u.id}`);
});

router.get('/notifications', requireLogin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const total = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ?').get(req.user.id).c;
  const pages = Math.max(1, Math.ceil(total / 30));
  const items = notify.list(req.user.id, 30, (Math.min(page, pages) - 1) * 30);
  res.render('notifications', { title: 'Bildirimler', items, page: Math.min(page, pages), pages });
});

router.get('/notifications/:id', requireLogin, (req, res, next) => {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!n) return next();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(n.id);
  res.redirect(notify.link(n));
});

router.post('/notifications/read-all', requireLogin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(req.user.id);
  const back = req.get('referer');
  res.redirect(back && new URL(back).host === req.get('host') ? back : '/notifications');
});

router.get('/account', requireLogin, (req, res) => {
  res.render('account', { title: 'Hesap ayarları', error: null });
});

router.post('/account', requireLogin, (req, res) => {
  const b = req.body;
  if (b.form === 'profile') {
    db.prepare('UPDATE users SET about = ?, location = ? WHERE id = ?')
      .run(String(b.about || '').slice(0, 2000), String(b.location || '').slice(0, 60), req.user.id);
    flash(req, 'ok', 'Profilin güncellendi.');
  } else if (b.form === 'password') {
    if (!verifyPassword(b.current || '', req.user.password_hash)) {
      return res.status(400).render('account', { title: 'Hesap ayarları', error: 'Mevcut şifre hatalı.' });
    }
    if (String(b.next || '').length < 3) {
      return res.status(400).render('account', { title: 'Hesap ayarları', error: 'Yeni şifre en az 3 karakter olmalı.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.next), req.user.id);
    flash(req, 'ok', 'Şifren değiştirildi.');
  }
  res.redirect('/account');
});

const COL = { avatar: 'avatar_url', banner: 'banner_url' };
const LABEL = { avatar: 'Avatarın', banner: 'Kapak görselin' };

function setImage(user, kind, url) {
  removeLocal(user[COL[kind]]);
  db.prepare(`UPDATE users SET ${COL[kind]} = ? WHERE id = ?`).run(url, user.id);
}

router.post('/account/upload/:kind', requireLogin, (req, res, next) => {
  const kind = req.params.kind;
  if (!COL[kind]) return next();
  upload.single('image')(req, res, (err) => {
    try {
      if (err) throw new Error(err.code === 'LIMIT_FILE_SIZE' ? 'Dosya çok büyük.' : 'Yükleme başarısız oldu.');
      const url = saveImage(req.file, kind, req.user.id);
      setImage(req.user, kind, url);
      flash(req, 'ok', `${LABEL[kind]} güncellendi.`);
    } catch (e) {
      flash(req, 'error', e.message);
    }
    res.redirect('/account#gorseller');
  });
});

router.post('/account/image/:kind', requireLogin, (req, res, next) => {
  const kind = req.params.kind;
  if (!COL[kind]) return next();
  if (req.body.action === 'remove') {
    setImage(req.user, kind, null);
    flash(req, 'ok', `${LABEL[kind]} kaldırıldı.`);
  } else {
    const url = safeUrl(req.body.url);
    if (!url) flash(req, 'error', 'Bağlantı http:// veya https:// ile başlamalı.');
    else { setImage(req.user, kind, url); flash(req, 'ok', `${LABEL[kind]} güncellendi.`); }
  }
  res.redirect('/account#gorseller');
});

module.exports = router;
