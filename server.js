const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));

const PORT = process.env.PORT || 3000;
const pub = path.join(__dirname, 'public');

// ---------- MongoDB ----------
let dbState = 'not configured';
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => { dbState = 'connected'; })
    .catch((e) => { dbState = 'error: ' + e.message; });
}

// ---------- Admin login protection ----------
const MAX_TRIES = 3;                 // wrong passwords before lock (set 1 to lock on the first mistake)
const LOCK_MS = 60 * 60 * 1000;      // lock time: 1 hour
const SESSION_MS = 8 * 60 * 60 * 1000;
const attempts = new Map();          // ip -> { fails, lockUntil }

const SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('earnhub:' + (process.env.ADMIN_PASS || '')).digest('hex');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const exp = String(Date.now() + SESSION_MS); return exp + '.' + sign(exp); };
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig) return false;
  const good = sign(exp);
  if (sig.length !== good.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(exp) > Date.now();
}
function getCookie(req, name) {
  const parts = (req.headers.cookie || '').split(';').map((s) => s.trim());
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return '';
}
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

app.post('/api/admin-login', (req, res) => {
  const pass = process.env.ADMIN_PASS;
  if (!pass) return res.status(503).json({ ok: false, msg: 'ADMIN_PASS is not set' });

  const ip = req.ip;
  const now = Date.now();
  const rec = attempts.get(ip) || { fails: 0, lockUntil: 0 };

  if (rec.lockUntil > now) {
    console.log('ADMIN LOGIN while locked, ip=' + ip);
    return res.status(429).json({ ok: false, locked: true, retryAfter: Math.ceil((rec.lockUntil - now) / 1000) });
  }

  const given = (req.body && req.body.password) || '';
  if (safeEqual(given, pass)) {
    attempts.delete(ip);
    res.setHeader(
      'Set-Cookie',
      'eh_admin=' + makeToken() + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + SESSION_MS / 1000
    );
    return res.json({ ok: true });
  }

  rec.fails += 1;
  console.log('ADMIN LOGIN FAILED, ip=' + ip + ', count=' + rec.fails);
  if (rec.fails >= MAX_TRIES) {
    rec.fails = 0;
    rec.lockUntil = now + LOCK_MS;
    attempts.set(ip, rec);
    return res.status(429).json({ ok: false, locked: true, retryAfter: LOCK_MS / 1000 });
  }
  attempts.set(ip, rec);
  res.status(401).json({ ok: false, left: MAX_TRIES - rec.fails });
});

function adminOnly(req, res, next) {
  if (validToken(getCookie(req, 'eh_admin'))) return next();
  res.redirect('/');
}

// ---------- Pages ----------
function page(name, inject) {
  return (req, res) => {
    const f = path.join(pub, name);
    if (!fs.existsSync(f)) return res.status(404).send('This page is not added yet.');
    if (!inject) return res.sendFile(f);
    fs.readFile(f, 'utf8', (err, html) => {
      if (err) return res.status(500).send('Error');
      res.type('html').send(html.replace('</body>', '<script src="/admin-gate.js"></script></body>'));
    });
  };
}

app.get('/health', (req, res) => res.json({ ok: true, db: dbState }));
app.get(['/admin', '/admin.html'], adminOnly, page('admin.html'));
app.get(['/smm', '/smm.html'], page('smm.html', true));
app.get(['/free', '/free.html'], page('free.html', true));
app.use(express.static(pub));

app.listen(PORT, () => console.log('EarnHub running on port ' + PORT));
