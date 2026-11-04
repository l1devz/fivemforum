const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const { db, getSetting, setSetting, now } = require('./db');
const h = require('./helpers');
const notify = require('./notify');
const conversations = require('./conversations');
const presence = require('./presence');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.disable('x-powered-by');

let secret = process.env.SESSION_SECRET || getSetting('session_secret');
if (!secret) { secret = h.newToken() + h.newToken(); setSetting('session_secret', secret); }

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(require('./uploads').UPLOAD_DIR, {
  maxAge: '30d', immutable: true, index: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieSession({ name: 'fs_sess', secret, maxAge: 30 * 24 * 3600e3, sameSite: 'lax', httpOnly: true }));

app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = h.newToken();
  let user = null;
  if (req.session.uid) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.uid) || null;
    if (!user) req.session.uid = null;
    else if (!user.last_seen || now() - user.last_seen > 60e3) {
      db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now(), user.id);
    }
  }
  req.user = user;
  if (!user) presence.touchGuest(`${req.ip}|${req.get('user-agent') || ''}`);
  const flash = req.session.flash; delete req.session.flash;
  Object.assign(res.locals, h, {
    user,
    isStaff: !!user && (user.role === 'admin' || user.role === 'moderator'),
    isAdmin: !!user && user.role === 'admin',
    csrf: req.session.csrf,
    flash,
    path: req.path,
    site: {
      name: getSetting('site_name', 'Forum'),
      tagline: getSetting('site_tagline', ''),
      announcement: getSetting('announcement', ''),
    },
    title: null,
    notifCount: 0,
    notifRecent: [],
    convCount: 0,
    convRecent: [],
    notifLink: notify.link,
  });
  if (user) {
    res.locals.notifCount = notify.unreadCount(user.id);
    res.locals.notifRecent = notify.list(user.id, 8);
    res.locals.convCount = conversations.unreadCount(user.id);
    res.locals.convRecent = conversations.listFor(user.id, 6);
  }
  next();
});

app.use((req, res, next) => {
  const token = (req.body && req.body._csrf) || req.query._csrf;
  if (req.method === 'POST' && token !== req.session.csrf) {
    return res.status(403).render('error', { title: 'Geçersiz istek', message: 'Oturum doğrulaması başarısız. Sayfayı yenileyip tekrar dene.' });
  }
  next();
});

app.use((req, res, next) => {
  if (req.user && req.user.is_banned && req.path !== '/logout') {
    return res.status(403).render('error', { title: 'Hesap yasaklı', message: 'Bu hesap forum yönetimi tarafından yasaklandı.' });
  }
  next();
});

app.use(require('./routes/auth'));
app.use(require('./routes/forum'));
app.use(require('./routes/members'));
app.use('/conversations', require('./routes/conversations'));
app.use('/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { title: 'Sayfa bulunamadı', message: 'Aradığın sayfa taşınmış ya da hiç var olmamış olabilir.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Sunucu hatası', message: 'Beklenmeyen bir hata oluştu.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Forum çalışıyor: http://localhost:${PORT}`));
