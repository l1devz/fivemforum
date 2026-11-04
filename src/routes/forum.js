const router = require('express').Router();
const { db, now, logAction } = require('../db');
const { flash, requireLogin, requireStaff, isStaff, canWrite, LEVELS } = require('../middleware');
const notify = require('../notify');
const presence = require('../presence');

const allPrefixes = () => db.prepare('SELECT * FROM prefixes ORDER BY position, id').all();
function validPrefix(id) {
  const n = parseInt(id);
  return n && db.prepare('SELECT 1 FROM prefixes WHERE id = ?').get(n) ? n : null;
}

const PER_PAGE = 15;

const userCols = `u.id AS uid, u.username, u.role, u.title AS utitle, u.name_color, u.avatar_url`;

function forumStats(forumId) {
  return db.prepare(`SELECT
      (SELECT COUNT(*) FROM threads WHERE forum_id = ?) AS threads,
      (SELECT COUNT(*) FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.forum_id = ?) AS posts`).get(forumId, forumId);
}

function lastPostIn(forumId) {
  return db.prepare(`SELECT t.id AS tid, t.title, p.created_at, ${userCols}
      FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
      WHERE t.forum_id = ? ORDER BY p.id DESC LIMIT 1`).get(forumId);
}

const THREAD_LIST_SQL = `SELECT t.*, f.title AS forum_title,
    p.label AS prefix_label, p.color AS prefix_color,
    u.id AS uid, u.username, u.avatar_url, u.name_color,
    lu.id AS luid, lu.username AS lusername, lu.avatar_url AS lavatar, lu.name_color AS lcolor,
    (SELECT COUNT(*) - 1 FROM posts WHERE thread_id = t.id) AS replies,
    (SELECT COUNT(*) FROM reactions r JOIN posts rp ON rp.id = r.post_id WHERE rp.thread_id = t.id) AS reactions
  FROM threads t
  JOIN forums f ON f.id = t.forum_id
  JOIN users u ON u.id = t.user_id
  LEFT JOIN prefixes p ON p.id = t.prefix_id
  LEFT JOIN posts lp ON lp.id = (SELECT MAX(id) FROM posts WHERE thread_id = t.id)
  LEFT JOIN users lu ON lu.id = lp.user_id`;

function threadList(where, order, limit, ...params) {
  return db.prepare(`${THREAD_LIST_SQL} ${where ? 'WHERE ' + where : ''} ORDER BY ${order} LIMIT ${Number(limit)}`).all(...params);
}

const HOME_TABS = [
  { key: 'latest', label: 'Yeni mesajlar', icon: 'chat', order: 't.last_post_at DESC' },
  { key: 'newest', label: 'Yeni konular', icon: 'file', order: 't.created_at DESC' },
  { key: 'replies', label: 'En çok mesaj', icon: 'reply', order: 'replies DESC, t.last_post_at DESC' },
  { key: 'reactions', label: 'En çok tepki', icon: 'heart', order: 'reactions DESC, t.last_post_at DESC' },
  { key: 'views', label: 'En çok görüntülenen', icon: 'eye', order: 't.views DESC, t.last_post_at DESC' },
];

router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY position, id').all();
  const forums = db.prepare('SELECT * FROM forums ORDER BY position, id').all();
  for (const c of categories) {
    c.forums = forums.filter((f) => f.category_id === c.id).map((f) => ({ ...f, stats: forumStats(f.id), last: lastPostIn(f.id) }));
  }

  const featured = threadList('t.is_featured = 1', 't.last_post_at DESC', 10);
  const tabs = HOME_TABS.map((tab) => ({
    ...tab,
    rows: tab.key === 'latest'
      ? [...featured, ...threadList('t.is_featured = 0', tab.order, 20)]
      : threadList('', tab.order, 20),
  }));
  const ticker = [...featured, ...threadList('t.is_featured = 0', 't.created_at DESC', 8)].slice(0, 10);

  const stats = db.prepare(`SELECT (SELECT COUNT(*) FROM threads) threads, (SELECT COUNT(*) FROM posts) posts, (SELECT COUNT(*) FROM users) users`).get();
  const newest = db.prepare('SELECT id, username, name_color, avatar_url FROM users ORDER BY id DESC LIMIT 1').get();
  const online = db.prepare(`SELECT id, username, name_color, role FROM users WHERE last_seen > ? ORDER BY role = 'admin' DESC, role = 'moderator' DESC, last_seen DESC LIMIT 60`).all(now() - presence.WINDOW);
  const guests = presence.guestCount();
  const latestPosts = db.prepare(`SELECT p.id, p.created_at, t.id AS tid, t.title, f.title AS forum,
        pr.label AS prefix_label, pr.color AS prefix_color, u.id AS uid, u.username, u.avatar_url, u.name_color
      FROM posts p JOIN threads t ON t.id = p.thread_id JOIN forums f ON f.id = t.forum_id JOIN users u ON u.id = p.user_id
      LEFT JOIN prefixes pr ON pr.id = t.prefix_id
      WHERE p.id IN (SELECT MAX(id) FROM posts GROUP BY thread_id) ORDER BY p.id DESC LIMIT 8`).all();
  res.render('home', { categories, stats, newest, online, guests, latestPosts, tabs, ticker });
});

router.get('/forum/:id', (req, res, next) => {
  const forum = db.prepare('SELECT f.*, c.title AS category FROM forums f JOIN categories c ON c.id = f.category_id WHERE f.id = ?').get(req.params.id);
  if (!forum) return next();
  const prefixFilter = validPrefix(req.query.prefix);
  const where = prefixFilter ? 't.forum_id = ? AND t.prefix_id = ?' : 't.forum_id = ?';
  const params = prefixFilter ? [forum.id, prefixFilter] : [forum.id];
  const total = db.prepare(`SELECT COUNT(*) c FROM threads t WHERE ${where}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(req.query.page) || 1));
  const threads = db.prepare(`${THREAD_LIST_SQL} WHERE ${where} ORDER BY t.is_pinned DESC, t.last_post_at DESC LIMIT ? OFFSET ?`)
    .all(...params, PER_PAGE, (page - 1) * PER_PAGE);
  const usedPrefixes = db.prepare(`SELECT p.*, COUNT(*) n FROM threads t JOIN prefixes p ON p.id = t.prefix_id
      WHERE t.forum_id = ? GROUP BY p.id ORDER BY p.position`).all(forum.id);
  const canPost = canWrite(req.user, forum.thread_level);
  res.render('forum', { title: forum.title, forum, threads, page, pages, canPost, usedPrefixes, prefixFilter });
});

router.get('/forum/:id/new', requireLogin, (req, res, next) => {
  const forum = db.prepare('SELECT * FROM forums WHERE id = ?').get(req.params.id);
  if (!forum) return next();
  if (!canWrite(req.user, forum.thread_level)) return res.status(403).render('error', { title: 'Yetkin yok', message: `Bu foruma yalnızca ${LEVELS[forum.thread_level].who} konu açabilir.` });
  res.render('thread_new', { title: 'Yeni konu', forum, error: null, form: {}, prefixes: allPrefixes() });
});

router.post('/forum/:id/new', requireLogin, (req, res, next) => {
  const forum = db.prepare('SELECT * FROM forums WHERE id = ?').get(req.params.id);
  if (!forum) return next();
  if (!canWrite(req.user, forum.thread_level)) return res.status(403).render('error', { title: 'Yetkin yok', message: `Bu foruma yalnızca ${LEVELS[forum.thread_level].who} konu açabilir.` });
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  let error = null;
  if (title.length < 3 || title.length > 120) error = 'Başlık 3-120 karakter arasında olmalı.';
  else if (body.length < 2) error = 'Mesaj boş olamaz.';
  const prefixId = validPrefix(req.body.prefix_id);
  if (error) return res.status(400).render('thread_new', { title: 'Yeni konu', forum, error, form: { title, body, prefix_id: prefixId }, prefixes: allPrefixes() });

  const t = now();
  const staff = isStaff(req.user);
  const pinned = staff && req.body.pin ? 1 : 0;
  const featured = staff && req.body.feature ? 1 : 0;
  const tid = Number(db.prepare('INSERT INTO threads(forum_id, user_id, title, prefix_id, is_pinned, is_featured, created_at, last_post_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
    .run(forum.id, req.user.id, title, prefixId, pinned, featured, t, t).lastInsertRowid);
  const pid = Number(db.prepare('INSERT INTO posts(thread_id, user_id, body, created_at) VALUES(?, ?, ?, ?)').run(tid, req.user.id, body, t).lastInsertRowid);
  notify.onNewPost({ post: { id: pid, body }, thread: { id: tid }, actor: req.user, isNewThread: true });
  res.redirect(`/thread/${tid}`);
});

function loadThread(id) {
  return db.prepare(`SELECT t.*, f.title AS forum_title, f.id AS forum_id, f.reply_level, c.title AS category,
        p.label AS prefix_label, p.color AS prefix_color
      FROM threads t JOIN forums f ON f.id = t.forum_id JOIN categories c ON c.id = f.category_id
      LEFT JOIN prefixes p ON p.id = t.prefix_id WHERE t.id = ?`).get(id);
}

function similarThreads(thread, limit = 5) {
  const stop = new Set(['için', 'gibi', 'olan', 'olarak', 'daha', 'veya', 'nasıl', 'neden', 'free', 'ücretsiz', 'sistemi', 'sistem']);
  const words = [...new Set(thread.title.toLocaleLowerCase('tr-TR').split(/[^\p{L}0-9]+/u))]
    .filter((w) => w.length >= 4 && !stop.has(w)).sort((a, b) => b.length - a.length).slice(0, 4);
  let rows = [];
  if (words.length) {
    const score = words.map(() => '(LOWER(t.title) LIKE ?)').join(' + ');
    rows = db.prepare(`${THREAD_LIST_SQL} WHERE t.id <> ? AND (${score}) > 0
        ORDER BY (${score}) DESC, (t.forum_id = ?) DESC, t.last_post_at DESC LIMIT ?`)
      .all(thread.id, ...words.map((w) => `%${w}%`), ...words.map((w) => `%${w}%`), thread.forum_id, limit);
  }
  if (rows.length < limit) {
    const have = new Set([thread.id, ...rows.map((r) => r.id)]);
    const more = threadList('t.forum_id = ?', 't.last_post_at DESC', limit + have.size, thread.forum_id).filter((r) => !have.has(r.id));
    rows = rows.concat(more.slice(0, limit - rows.length));
  }
  return rows;
}

router.get('/thread/:id', (req, res, next) => {
  const thread = loadThread(req.params.id);
  if (!thread) return next();
  const total = db.prepare('SELECT COUNT(*) c FROM posts WHERE thread_id = ?').get(thread.id).c;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  let page = req.query.page === 'last' ? pages : parseInt(req.query.page) || 1;
  page = Math.min(pages, Math.max(1, page));

  db.prepare('UPDATE threads SET views = views + 1 WHERE id = ?').run(thread.id);
  thread.views += 1;

  const posts = db.prepare(`SELECT p.*, ${userCols}, u.created_at AS joined, u.location,
        (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS user_posts,
        (SELECT COUNT(*) FROM reactions r JOIN posts rp ON rp.id = r.post_id WHERE rp.user_id = u.id) AS user_score,
        (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) AS likes
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.thread_id = ? ORDER BY p.id LIMIT ? OFFSET ?`).all(thread.id, PER_PAGE, (page - 1) * PER_PAGE);

  if (req.user && posts.length) {
    const mine = new Set(db.prepare(`SELECT post_id FROM reactions WHERE user_id = ? AND post_id IN (${posts.map(() => '?').join(',')})`)
      .all(req.user.id, ...posts.map((p) => p.id)).map((r) => r.post_id));
    posts.forEach((p) => (p.liked = mine.has(p.id)));
  }
  const firstPostId = db.prepare('SELECT MIN(id) id FROM posts WHERE thread_id = ?').get(thread.id).id;
  const forums = isStaff(req.user) ? db.prepare('SELECT id, title FROM forums ORDER BY category_id, position').all() : [];
  const author = db.prepare('SELECT user_id FROM threads WHERE id = ?').get(thread.id).user_id;
  const canPrefix = !!req.user && (req.user.id === author || isStaff(req.user));
  res.render('thread', {
    title: thread.title, thread, posts, page, pages, firstPostId, forums, offset: (page - 1) * PER_PAGE,
    similar: similarThreads(thread), prefixes: canPrefix ? allPrefixes() : [], canPrefix,
    canReply: canWrite(req.user, thread.reply_level), replyWho: LEVELS[thread.reply_level].who,
  });
});

router.post('/thread/:id/reply', requireLogin, (req, res, next) => {
  const thread = loadThread(req.params.id);
  if (!thread) return next();
  if (!canWrite(req.user, thread.reply_level)) {
    flash(req, 'error', `Bu bölümde yalnızca ${LEVELS[thread.reply_level].who} cevap yazabilir.`);
    return res.redirect(`/thread/${thread.id}`);
  }
  if (thread.is_locked && !isStaff(req.user)) {
    flash(req, 'error', 'Bu konu kilitli.');
    return res.redirect(`/thread/${thread.id}`);
  }
  const body = String(req.body.body || '').trim();
  if (body.length < 2) {
    flash(req, 'error', 'Mesaj çok kısa.');
    return res.redirect(`/thread/${thread.id}?page=last`);
  }
  const t = now();
  const pid = db.prepare('INSERT INTO posts(thread_id, user_id, body, created_at) VALUES(?, ?, ?, ?)').run(thread.id, req.user.id, body, t).lastInsertRowid;
  db.prepare('UPDATE threads SET last_post_at = ? WHERE id = ?').run(t, thread.id);
  notify.onNewPost({ post: { id: Number(pid), body }, thread, actor: req.user });
  res.redirect(`/thread/${thread.id}?page=last#post-${pid}`);
});

router.post('/thread/:id/mod', requireLogin, requireStaff, (req, res, next) => {
  const thread = loadThread(req.params.id);
  if (!thread) return next();
  const a = req.body.action;
  const log = (txt) => logAction(req.user.id, `${txt}: "${thread.title}" (#${thread.id})`);
  if (a === 'pin') { db.prepare('UPDATE threads SET is_pinned = 1 - is_pinned WHERE id = ?').run(thread.id); log(thread.is_pinned ? 'Sabit kaldırıldı' : 'Sabitlendi'); }
  else if (a === 'feature') { db.prepare('UPDATE threads SET is_featured = 1 - is_featured WHERE id = ?').run(thread.id); log(thread.is_featured ? 'Ana sayfadan kaldırıldı' : 'Ana sayfada öne çıkarıldı'); }
  else if (a === 'lock') { db.prepare('UPDATE threads SET is_locked = 1 - is_locked WHERE id = ?').run(thread.id); log(thread.is_locked ? 'Kilit açıldı' : 'Kilitlendi'); }
  else if (a === 'move') {
    const f = db.prepare('SELECT id, title FROM forums WHERE id = ?').get(req.body.forum_id);
    if (f) { db.prepare('UPDATE threads SET forum_id = ? WHERE id = ?').run(f.id, thread.id); log(`"${f.title}" forumuna taşındı`); }
  } else if (a === 'rename') {
    const nt = String(req.body.new_title || '').trim();
    if (nt.length >= 3 && nt.length <= 120) { db.prepare('UPDATE threads SET title = ? WHERE id = ?').run(nt, thread.id); log(`Başlık "${nt}" yapıldı`); }
  } else if (a === 'delete') {
    db.prepare('DELETE FROM threads WHERE id = ?').run(thread.id);
    log('Konu silindi');
    flash(req, 'ok', 'Konu silindi.');
    return res.redirect(`/forum/${thread.forum_id}`);
  }
  res.redirect(`/thread/${thread.id}`);
});

router.post('/thread/:id/prefix', requireLogin, (req, res, next) => {
  const thread = loadThread(req.params.id);
  if (!thread) return next();
  if (thread.user_id !== req.user.id && !isStaff(req.user)) return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu konunun önekini değiştiremezsin.' });
  db.prepare('UPDATE threads SET prefix_id = ? WHERE id = ?').run(validPrefix(req.body.prefix_id), thread.id);
  res.redirect(`/thread/${thread.id}`);
});

function loadPost(id) {
  return db.prepare('SELECT p.*, t.title AS thread_title, t.is_locked FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?').get(id);
}
const canEdit = (user, post) => !!user && (user.id === post.user_id || isStaff(user));

router.get('/post/:id/edit', requireLogin, (req, res, next) => {
  const post = loadPost(req.params.id);
  if (!post) return next();
  if (!canEdit(req.user, post)) return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu mesajı düzenleyemezsin.' });
  res.render('post_edit', { title: 'Mesajı düzenle', post });
});

router.post('/post/:id/edit', requireLogin, (req, res, next) => {
  const post = loadPost(req.params.id);
  if (!post) return next();
  if (!canEdit(req.user, post)) return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu mesajı düzenleyemezsin.' });
  const body = String(req.body.body || '').trim();
  if (body.length >= 2) db.prepare('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(body, now(), post.id);
  res.redirect(`/post/${post.id}`);
});

router.post('/post/:id/delete', requireLogin, (req, res, next) => {
  const post = loadPost(req.params.id);
  if (!post) return next();
  if (!canEdit(req.user, post)) return res.status(403).render('error', { title: 'Yetkin yok', message: 'Bu mesajı silemezsin.' });
  const first = db.prepare('SELECT MIN(id) id FROM posts WHERE thread_id = ?').get(post.thread_id).id;
  if (first === post.id) {
    flash(req, 'error', 'Konunun ilk mesajı silinemez; konuyu silmek için moderasyon araçlarını kullan.');
    return res.redirect(`/thread/${post.thread_id}`);
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  if (req.user.id !== post.user_id) logAction(req.user.id, `Mesaj silindi (#${post.id}) — "${post.thread_title}"`);
  flash(req, 'ok', 'Mesaj silindi.');
  res.redirect(`/thread/${post.thread_id}?page=last`);
});

router.post('/post/:id/react', requireLogin, (req, res, next) => {
  const post = loadPost(req.params.id);
  if (!post) return next();
  if (post.user_id !== req.user.id) {
    const had = db.prepare('SELECT 1 FROM reactions WHERE post_id = ? AND user_id = ?').get(post.id, req.user.id);
    if (had) db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ?').run(post.id, req.user.id);
    else db.prepare('INSERT INTO reactions(post_id, user_id, created_at) VALUES(?, ?, ?)').run(post.id, req.user.id, now());
    notify.onReaction({ post, actor: req.user, added: !had });
  }
  res.redirect(`/post/${post.id}`);
});

router.get('/post/:id', (req, res, next) => {
  const post = db.prepare('SELECT id, thread_id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return next();
  const idx = db.prepare('SELECT COUNT(*) c FROM posts WHERE thread_id = ? AND id < ?').get(post.thread_id, post.id).c;
  res.redirect(`/thread/${post.thread_id}?page=${Math.floor(idx / PER_PAGE) + 1}#post-${post.id}`);
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  let results = [];
  if (q.length >= 2) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    results = db.prepare(`SELECT p.id, p.body, p.created_at, t.id AS tid, t.title, u.username, u.name_color
        FROM posts p JOIN threads t ON t.id = p.thread_id JOIN users u ON u.id = p.user_id
        WHERE t.title LIKE ? OR p.body LIKE ? ORDER BY p.id DESC LIMIT 40`).all(like, like);
  }
  res.render('search', { title: 'Arama', q, results });
});

module.exports = router;
