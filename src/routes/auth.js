const router = require('express').Router();
const { db, hashPassword, verifyPassword, now } = require('../db');
const { flash } = require('../middleware');

const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : '/');

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { title: 'Giriş yap', next: safeNext(req.query.next), error: null, username: '' });
});

router.post('/login', (req, res) => {
  const { username = '', password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).render('login', { title: 'Giriş yap', next: safeNext(req.body.next), error: 'Kullanıcı adı veya şifre hatalı.', username });
  }
  req.session.uid = user.id;
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
  flash(req, 'ok', `Tekrar hoş geldin, ${user.username}.`);
  res.redirect(safeNext(req.body.next));
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Kayıt ol', error: null, username: '' });
});

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const { password = '', password2 = '' } = req.body;
  let error = null;
  if (!/^[\p{L}0-9_.-]{2,24}$/u.test(username)) error = 'Kullanıcı adı 2-24 karakter olmalı; harf, rakam, _ . - kullanabilirsin.';
  else if (password.length < 3) error = 'Şifre en az 3 karakter olmalı.';
  else if (password !== password2) error = 'Şifreler eşleşmiyor.';
  else if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) error = 'Bu kullanıcı adı alınmış.';
  if (error) return res.status(400).render('register', { title: 'Kayıt ol', error, username });

  const info = db.prepare('INSERT INTO users(username, password_hash, created_at, last_seen) VALUES(?, ?, ?, ?)')
    .run(username, hashPassword(password), now(), now());
  req.session.uid = Number(info.lastInsertRowid);
  flash(req, 'ok', 'Hesabın oluşturuldu. Aramıza hoş geldin!');
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

module.exports = router;
