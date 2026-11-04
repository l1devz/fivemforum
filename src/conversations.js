const { db } = require('./db');

function unreadCount(userId) {
  return db.prepare(`SELECT COUNT(*) c FROM conversation_users cu JOIN conversations c ON c.id = cu.conversation_id
      WHERE cu.user_id = ? AND cu.has_left = 0 AND c.last_message_at > cu.last_read_at`).get(userId).c;
}

function listFor(userId, limit = 30, offset = 0) {
  const rows = db.prepare(`SELECT c.*, cu.last_read_at, (c.last_message_at > cu.last_read_at) AS unread,
        (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = c.id) AS message_count,
        lm.body AS last_body, lu.id AS last_uid, lu.username AS last_username, lu.avatar_url AS last_avatar
      FROM conversation_users cu
      JOIN conversations c ON c.id = cu.conversation_id
      LEFT JOIN conversation_messages lm ON lm.id = (SELECT MAX(id) FROM conversation_messages WHERE conversation_id = c.id)
      LEFT JOIN users lu ON lu.id = lm.user_id
      WHERE cu.user_id = ? AND cu.has_left = 0
      ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);
  for (const r of rows) r.participants = participants(r.id);
  return rows;
}

function participants(convId) {
  return db.prepare(`SELECT u.id, u.username, u.avatar_url, u.name_color, u.role, cu.has_left
      FROM conversation_users cu JOIN users u ON u.id = cu.user_id
      WHERE cu.conversation_id = ? ORDER BY u.username`).all(convId);
}

function membership(convId, userId) {
  return db.prepare('SELECT * FROM conversation_users WHERE conversation_id = ? AND user_id = ?').get(convId, userId);
}

module.exports = { unreadCount, listFor, participants, membership };
