const crypto = require('crypto');
const WINDOW = 15 * 60e3;
const guests = new Map();

function touchGuest(key) {
  const gid = crypto.createHash('sha1').update(key).digest('base64').slice(0, 16);
  guests.set(gid, Date.now());
  if (guests.size > 5000) prune();
}

function prune() {
  const limit = Date.now() - WINDOW;
  for (const [k, t] of guests) if (t < limit) guests.delete(k);
}

function guestCount() {
  prune();
  return guests.size;
}

module.exports = { touchGuest, guestCount, WINDOW };
