const { db, now } = require('./db');

function insert(userId, actorId, type, { threadId = null, postId = null, extra = null } = {}) {
  if (!userId || userId === actorId) return;
  db.prepare(`INSERT INTO notifications(user_id, actor_id, type, thread_id, post_id, extra, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)`).run(userId, actorId, type, threadId, postId, extra, now());
}

function extractNames(body) {
  const quoted = new Set();
  const mentioned = new Set();
  for (const m of String(body).matchAll(/\[quote=([^\]]{1,40})\]/gi)) quoted.add(m[1].trim().toLowerCase());
  const outside = String(body).replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/gi, '').replace(/\[code\][\s\S]*?\[\/code\]/gi, '');
  for (const m of outside.matchAll(/(^|[^\p{L}0-9_])@([\p{L}0-9_.-]{2,24})/gu)) mentioned.add(m[2].replace(/[.-]+$/, '').toLowerCase());
  return { quoted, mentioned };
}

function usersByNames(names) {
  if (!names.size) return [];
  const list = [...names];
  return db.prepare(`SELECT id, username FROM users WHERE LOWER(username) IN (${list.map(() => '?').join(',')})`).all(...list);
}

function onNewPost({ post, thread, actor, isNewThread = false }) {
  const done = new Set([actor.id]);
  const { quoted, mentioned } = extractNames(post.body);

  for (const u of usersByNames(quoted)) {
    if (done.has(u.id)) continue;
    insert(u.id, actor.id, 'quote', { threadId: thread.id, postId: post.id });
    done.add(u.id);
  }
  for (const u of usersByNames(mentioned)) {
    if (done.has(u.id)) continue;
    insert(u.id, actor.id, 'mention', { threadId: thread.id, postId: post.id });
    done.add(u.id);
  }
  if (isNewThread) return;

  const watchers = db.prepare('SELECT DISTINCT user_id FROM posts WHERE thread_id = ? AND id <> ?').all(thread.id, post.id).map((r) => r.user_id);
  for (const uid of watchers) {
    if (done.has(uid)) continue;
    done.add(uid);
    const existing = db.prepare(`SELECT id FROM notifications WHERE user_id = ? AND type = 'reply' AND thread_id = ? AND is_read = 0`).get(uid, thread.id);
    if (existing) {
      db.prepare('UPDATE notifications SET count = count + 1, actor_id = ?, post_id = ?, created_at = ? WHERE id = ?')
        .run(actor.id, post.id, now(), existing.id);
    } else {
      insert(uid, actor.id, 'reply', { threadId: thread.id, postId: post.id });
    }
  }
}

function onReaction({ post, actor, added }) {
  if (added) {
    insert(post.user_id, actor.id, 'reaction', { threadId: post.thread_id, postId: post.id });
  } else {
    db.prepare(`DELETE FROM notifications WHERE type = 'reaction' AND post_id = ? AND actor_id = ? AND is_read = 0`).run(post.id, actor.id);
  }
}

function onRoleChange({ userId, actorId, roleLabel }) {
  insert(userId, actorId, 'role', { extra: roleLabel });
}

function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0').get(userId).c;
}

function list(userId, limit = 30, offset = 0) {
  return db.prepare(`SELECT n.*, a.username AS actor_name, a.avatar_url, a.name_color, t.title AS thread_title
      FROM notifications n
      LEFT JOIN users a ON a.id = n.actor_id
      LEFT JOIN threads t ON t.id = n.thread_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);
}

function link(n) {
  if (n.post_id) return `/post/${n.post_id}`;
  if (n.thread_id) return `/thread/${n.thread_id}`;
  return `/member/${n.user_id}`;
}

module.exports = { onNewPost, onReaction, onRoleChange, unreadCount, list, link };
