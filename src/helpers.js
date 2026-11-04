const crypto = require('crypto');

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(u) {
  const url = String(u || '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

function youtubeId(url) {
  const m = String(url).match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function short(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

function inkFor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const v = parseInt(m[1], 16);
  const lum = (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.6 ? '#141414' : '#fff';
}

function renderBody(raw) {
  let html = escapeHtml(raw);
  const codeBlocks = [];
  html = html.replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, c) => {
    codeBlocks.push(c);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  html = html.replace(/(^|[\s(\]])@([\p{L}0-9_]{2,24})/gu, (m, pre, name) => `${pre}<a class="mention" href="/u/${encodeURIComponent(name)}">@${name}</a>`);
  html = html
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '<strong>$1</strong>')
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '<em>$1</em>')
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<u>$1</u>')
    .replace(/\[s\]([\s\S]*?)\[\/s\]/gi, '<s>$1</s>')
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => {
      const s = safeUrl(u.replace(/&amp;/g, '&'));
      return s ? `<a href="${escapeHtml(s)}" target="_blank" rel="nofollow noopener">${t}</a>` : t;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (m, u) => {
      const s = safeUrl(u.replace(/&amp;/g, '&'));
      return s ? `<a href="${escapeHtml(s)}" target="_blank" rel="nofollow noopener">${u}</a>` : u;
    })
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (m, u) => {
      const s = safeUrl(u.replace(/&amp;/g, '&'));
      return s ? `<img src="${escapeHtml(s)}" alt="" loading="lazy">` : '';
    })
    .replace(/\[(?:media|youtube)\]([\s\S]*?)\[\/(?:media|youtube)\]/gi, (m, u) => {
      const id = youtubeId(u.replace(/&amp;/g, '&').trim());
      return id
        ? `<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube videosu" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
        : u;
    })
    .replace(/\[spoiler\]([\s\S]*?)\[\/spoiler\]/gi, '<details class="spoiler"><summary>Spoiler</summary>$1</details>');
  for (let i = 0; i < 3; i++) {
    html = html
      .replace(/\[quote=([^\]]{1,40})\]([\s\S]*?)\[\/quote\]/gi, '<blockquote><cite>$1 dedi:</cite>$2</blockquote>')
      .replace(/\[quote\]([\s\S]*?)\[\/quote\]/gi, '<blockquote>$1</blockquote>');
  }
  html = html
    .replace(/\n*(<\/?blockquote>|<\/?details[^>]*>|<div class="embed">|<\/iframe><\/div>|\u0000CODE\d+\u0000)\n?/g, '$1')
    .replace(/\n/g, '<br>');
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<pre><code>${codeBlocks[i]}</code></pre>`);
  return html;
}

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MIN) return 'az önce';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} dk önce`;
  const d = new Date(ts);
  const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (ts >= today.getTime()) return `Bugün ${hm}`;
  if (ts >= today.getTime() - DAY) return `Dün ${hm}`;
  if (ts >= today.getTime() - 6 * DAY) return `${d.toLocaleDateString('tr-TR', { weekday: 'long' })} ${hm}`;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fullDate(ts) {
  return new Date(ts).toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function memberFor(ts) {
  const start = new Date(ts), end = new Date();
  let y = end.getFullYear() - start.getFullYear();
  let m = end.getMonth() - start.getMonth();
  let d = end.getDate() - start.getDate();
  if (d < 0) { m--; d += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  const parts = [];
  if (y) parts.push(`${y} yıl`);
  if (m) parts.push(`${m} ay`);
  if (d || !parts.length) parts.push(`${d} gün`);
  return parts.join(' ');
}

const ROLES = {
  admin: { label: 'Administrator', cls: 'role-admin' },
  moderator: { label: 'Moderatör', cls: 'role-mod' },
  member: { label: 'Üye', cls: 'role-member' },
};

function initials(name) {
  return String(name || '?').slice(0, 2).toUpperCase();
}

function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function slug(s) {
  return String(s).toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'konu';
}

const newToken = () => crypto.randomBytes(18).toString('hex');

module.exports = { short, inkFor, youtubeId, escapeHtml, safeUrl, renderBody, timeAgo, fullDate, memberFor, ROLES, initials, hue, slug, newToken };
