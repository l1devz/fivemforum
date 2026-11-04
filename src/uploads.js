const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const LIMITS = { avatar: 2 * 1024 * 1024, banner: 5 * 1024 * 1024 };

function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 6).toString('ascii') === 'GIF87a' || buf.slice(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.banner, files: 1 },
});

function saveImage(file, kind, userId) {
  if (!file) throw new Error('Bir görsel seçmedin.');
  if (file.size > LIMITS[kind]) throw new Error(`Dosya çok büyük. En fazla ${LIMITS[kind] / 1024 / 1024} MB yükleyebilirsin.`);
  const ext = sniff(file.buffer);
  if (!ext) throw new Error('Sadece JPG, PNG, GIF veya WEBP görseller yüklenebilir.');
  const name = `${kind[0]}${userId}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return `/uploads/${name}`;
}

function removeLocal(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const file = path.join(UPLOAD_DIR, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

module.exports = { upload, saveImage, removeLocal, UPLOAD_DIR, LIMITS };
