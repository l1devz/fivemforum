document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !confirm(msg)) e.preventDefault();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-confirm-click]');
  if (b && !confirm(b.getAttribute('data-confirm-click'))) e.preventDefault();
});

document.addEventListener('click', (e) => {
  document.querySelectorAll('details.menu[open]').forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    const i = document.querySelector('.topsearch input');
    if (i) { e.preventDefault(); i.focus(); }
  }
});

function wrap(ta, open, close) {
  const s = ta.selectionStart, en = ta.selectionEnd;
  const sel = ta.value.slice(s, en);
  ta.setRangeText(open + sel + close, s, en, 'end');
  if (!sel) ta.selectionStart = ta.selectionEnd = s + open.length;
  ta.focus();
}
document.querySelectorAll('.editor').forEach((ed) => {
  const ta = ed.querySelector('textarea');
  ed.querySelectorAll('[data-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tag;
      if (t === 'url') {
        const u = prompt('Bağlantı adresi:', 'https://');
        if (u) wrap(ta, `[url=${u}]`, '[/url]');
      } else if (t === 'img') {
        const u = prompt('Görsel adresi:', 'https://');
        if (u) wrap(ta, `[img]${u}`, '[/img]');
      } else if (t === 'media') {
        const u = prompt('YouTube video bağlantısı:', 'https://www.youtube.com/watch?v=');
        if (u) wrap(ta, `[media]${u}`, '[/media]');
      } else wrap(ta, `[${t}]`, `[/${t}]`);
    });
  });
});

const IMG_LIMIT = { avatar: 2 * 1024 * 1024, banner: 5 * 1024 * 1024 };
function processImage(file, kind) {
  return new Promise((resolve) => {
    if (file.type === 'image/gif') return resolve(file);
    const img = new Image();
    img.onload = () => {
      let sx = 0, sy = 0, sw = img.width, sh = img.height, w, h;
      if (kind === 'avatar') {
        const side = Math.min(img.width, img.height);
        sx = (img.width - side) / 2; sy = (img.height - side) / 2; sw = sh = side;
        w = h = Math.min(512, side);
      } else {
        const scale = Math.min(1, 1600 / img.width);
        w = Math.round(img.width * scale); h = Math.round(img.height * scale);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      c.toBlob((blob) => {
        URL.revokeObjectURL(img.src);
        if (!blob || blob.size > file.size && file.size <= IMG_LIMIT[kind]) return resolve(file);
        const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        resolve(new File([blob], `${kind}.${ext}`, { type: blob.type }));
      }, 'image/webp', 0.88);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}
document.querySelectorAll('.imgrow-upload').forEach((form) => {
  const input = form.querySelector('input[type=file]');
  const kind = form.dataset.kind;
  const btn = form.querySelector('button');
  const label = form.querySelector('.filepick span');
  input.addEventListener('change', async () => {
    const original = input.files[0];
    if (!original) return;
    const file = await processImage(original, kind);
    if (file.size > IMG_LIMIT[kind]) {
      alert(`Dosya çok büyük. En fazla ${IMG_LIMIT[kind] / 1024 / 1024} MB yükleyebilirsin.`);
      input.value = '';
      return;
    }
    if (file !== original) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    }
    const url = URL.createObjectURL(file);
    if (kind === 'avatar') {
      const box = document.querySelector('[data-preview=avatar]');
      box.innerHTML = '';
      const im = document.createElement('img');
      im.className = 'av'; im.src = url; im.width = im.height = 112;
      im.style.width = im.style.height = '112px';
      box.appendChild(im);
    } else {
      document.querySelector('[data-preview=banner]').style.backgroundImage = `url("${url}")`;
    }
    label.textContent = original.name.length > 22 ? original.name.slice(0, 20) + '…' : original.name;
    btn.hidden = false;
    btn.textContent = `Yükle (${(file.size / 1024).toFixed(0)} KB)`;
  });
  form.addEventListener('submit', () => { btn.disabled = true; btn.textContent = 'Yükleniyor…'; });
});

document.querySelectorAll('[data-tabs]').forEach((box) => {
  const buttons = box.querySelectorAll('[data-tab]');
  const show = (key) => {
    buttons.forEach((b) => { const on = b.dataset.tab === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    box.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== key; });
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    show(b.dataset.tab);
    try { localStorage.setItem('homeTab', b.dataset.tab); } catch (e) {}
  }));
  try {
    const saved = localStorage.getItem('homeTab');
    if (saved && box.querySelector(`[data-tab="${saved}"]`)) show(saved);
  } catch (e) {}
});

document.querySelectorAll('[data-ticker]').forEach((tk) => {
  const items = tk.querySelectorAll('.ticker-item');
  const stats = tk.querySelectorAll('.ticker-stat');
  if (items.length < 2) return;
  let i = 0, timer = null, paused = false;
  const go = (n) => {
    items[i].classList.remove('on'); stats[i].classList.remove('on');
    i = (n + items.length) % items.length;
    items[i].classList.add('on'); stats[i].classList.add('on');
  };
  const start = () => { clearInterval(timer); if (!paused) timer = setInterval(() => go(i + 1), 5000); };
  tk.querySelector('[data-tk=prev]').onclick = () => { go(i - 1); start(); };
  tk.querySelector('[data-tk=next]').onclick = () => { go(i + 1); start(); };
  const pb = tk.querySelector('[data-tk=pause]');
  pb.onclick = () => {
    paused = !paused;
    pb.classList.toggle('on', paused);
    pb.setAttribute('aria-label', paused ? 'Devam et' : 'Duraklat');
    start();
  };
  tk.addEventListener('mouseenter', () => clearInterval(timer));
  tk.addEventListener('mouseleave', start);
  start();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('.editor textarea')) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

(() => {
  const convo = document.querySelector('.convo');
  if (!convo || location.hash) return;
  const target = convo.querySelector('.newline') || convo.querySelector('.msg:last-of-type');
  if (target) target.scrollIntoView({ block: 'center' });
})();

document.querySelectorAll('.js-quote').forEach((btn) => {
  btn.addEventListener('click', () => {
    const ta = document.querySelector('#reply textarea');
    if (!ta) return;
    ta.value += (ta.value ? '\n' : '') + `[quote=${btn.dataset.user}]${btn.dataset.body}[/quote]\n`;
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
});
