function flash(req, type, text) {
  req.session.flash = { type, text };
}

function requireLogin(req, res, next) {
  if (!req.user) {
    flash(req, 'info', 'Devam etmek için giriş yapmalısın.');
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireStaff(req, res, next) {
  if (!req.user || !['admin', 'moderator'].includes(req.user.role)) {
    return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu işlem için moderatör yetkisi gerekiyor.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu alan yalnızca yöneticilere açık.' });
  }
  next();
}

const isStaff = (u) => !!u && (u.role === 'admin' || u.role === 'moderator');

const LEVELS = {
  member: { label: 'Herkes', who: 'üyeler' },
  staff: { label: 'Yetkililer', who: 'yetkililer' },
  admin: { label: 'Sadece admin', short: 'Admin', who: 'yöneticiler' },
};
function canWrite(user, level) {
  if (!user) return false;
  if (level === 'admin') return user.role === 'admin';
  if (level === 'staff') return isStaff(user);
  return true;
}

module.exports = { flash, requireLogin, requireStaff, requireAdmin, isStaff, canWrite, LEVELS };
