const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const util = require('util');
const path = require('path');
const fs = require('fs');

const scrypt = util.promisify(crypto.scrypt);
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

const PORT = process.env.PORT || 3000;
const pub = path.join(__dirname, 'public');
const USD_RATE = Number(process.env.USD_RATE) || 125;
const WALLET_URL = (process.env.WALLET_API_URL || '').replace(/\/$/, '');
const WALLET_KEY = process.env.WALLET_API_KEY || '';
const WALLET_SECRET = process.env.WALLET_WEBHOOK_SECRET || '';

// ================= MongoDB =================
let dbState = 'not configured';
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => { dbState = 'connected'; })
    .catch((e) => { dbState = 'error: ' + e.message; });
}

const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  phone: String,
  site: { type: String, enum: ['smm', 'free'], required: true },
  salt: String,
  hash: String,
  balance: { type: Number, default: 0 },   // smm: USD, free: BDT
  pkg: { type: Number, default: 0 },
  banned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
}));

const reqSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  username: String,
  site: String,
  type: { type: String, enum: ['deposit', 'withdraw'] },
  amount: Number,        // in the site's currency
  amountBdt: Number,
  method: String,        // bKash / Nagad
  reference: String,     // deposit: Transaction ID, withdraw: account number
  status: { type: String, default: 'pending', index: true },
  walletSent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  doneAt: Date
});
// the same deposit Transaction ID can never be used twice
reqSchema.index({ reference: 1 }, { unique: true, partialFilterExpression: { type: 'deposit' } });
const Req = mongoose.model('Req', reqSchema);

// ================= Helpers =================
const SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('earnhub:' + (process.env.ADMIN_PASS || 'x')).digest('hex');
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function getCookie(req, name) {
  const parts = (req.headers.cookie || '').split(';').map((s) => s.trim());
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return '';
}
const ah = (fn) => (req, res, next) =>
  fn(req, res, next).catch((e) => { console.error(e); res.status(500).json({ ok: false, msg: 'server error' }); });
function needDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ ok: false, msg: 'database not ready' });
  next();
}

// simple per-IP rate limit
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + req.path;
    const now = Date.now();
    const h = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) return res.status(429).json({ ok: false, msg: 'too many requests, try later' });
    h.push(now);
    hits.set(k, h);
    next();
  };
}

// ================= Admin gate (password, 1 hour lock) =================
const MAX_TRIES = 3;
const LOCK_MS = 60 * 60 * 1000;
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
const attempts = new Map();
const makeAdminToken = () => { const exp = String(Date.now() + ADMIN_SESSION_MS); return exp + '.' + sign('admin:' + exp); };
function validAdminToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig) return false;
  return safeEq(sig, sign('admin:' + exp)) && Number(exp) > Date.now();
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
  if (safeEq(given, pass)) {
    attempts.delete(ip);
    res.setHeader('Set-Cookie', 'eh_admin=' + makeAdminToken() + '; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=' + ADMIN_SESSION_MS / 1000);
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
  if (validAdminToken(getCookie(req, 'eh_admin'))) return next();
  res.redirect('/');
}

// ================= User accounts =================
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
function setUserCookie(res, id) {
  const exp = String(Date.now() + USER_SESSION_MS);
  res.setHeader('Set-Cookie', 'eh_user=' + id + '.' + exp + '.' + sign('u:' + id + '.' + exp) + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + USER_SESSION_MS / 1000);
}
async function hashPw(pw, salt) { return (await scrypt(pw, salt, 64)).toString('hex'); }
const publicUser = (u) => ({ username: u.username, site: u.site, balance: u.balance, pkg: u.pkg });

async function auth(req, res, next) {
  try {
    const [id, exp, sig] = getCookie(req, 'eh_user').split('.');
    if (!id || !exp || !sig || !safeEq(sig, sign('u:' + id + '.' + exp)) || Number(exp) < Date.now() || !mongoose.isValidObjectId(id)) {
      return res.status(401).json({ ok: false, msg: 'login required' });
    }
    const u = await User.findById(id);
    if (!u || u.banned) return res.status(401).json({ ok: false, msg: 'login required' });
    req.user = u;
    next();
  } catch (e) { res.status(500).json({ ok: false, msg: 'server error' }); }
}

app.post('/api/register', needDb, limit(10, 60000), ah(async (req, res) => {
  const { username = '', phone = '', password = '', site = '' } = req.body || {};
  const un = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(un)) return res.status(400).json({ ok: false, msg: 'ইউজারনেম ৩–২০ অক্ষর, শুধু ইংরেজি অক্ষর, সংখ্যা, _ বা .' });
  if (!/^01\d{9}$/.test(String(phone))) return res.status(400).json({ ok: false, msg: 'সঠিক ১১ সংখ্যার ফোন নাম্বার দিন।' });
  if (String(password).length < 6) return res.status(400).json({ ok: false, msg: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
  if (!['smm', 'free'].includes(site)) return res.status(400).json({ ok: false, msg: 'সাইট বেছে নিন।' });
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const u = await User.create({ username: un, phone: String(phone), site, salt, hash: await hashPw(String(password), salt) });
    setUserCookie(res, u._id);
    res.json({ ok: true, user: publicUser(u) });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ ok: false, msg: 'এই ইউজারনেম আগেই নেওয়া হয়েছে।' });
    throw e;
  }
}));

app.post('/api/login', needDb, limit(15, 60000), ah(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = await User.findOne({ username: String(username).trim().toLowerCase() });
  if (!u || u.banned || !safeEq(await hashPw(String(password), u.salt), u.hash)) {
    return res.status(401).json({ ok: false, msg: 'ইউজারনেম বা পাসওয়ার্ড মিলছে না।' });
  }
  setUserCookie(res, u._id);
  res.json({ ok: true, user: publicUser(u) });
}));

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'eh_user=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', needDb, auth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }));

// ================= Wallet: send requests out =================
async function sendToWallet(r) {
  if (!WALLET_URL || !WALLET_KEY) return false;
  try {
    const resp = await fetch(WALLET_URL + '/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': WALLET_KEY },
      body: JSON.stringify({
        requestId: String(r._id),
        type: r.type,
        site: r.site,
        username: r.username,
        amount: r.amount,
        currency: r.site === 'smm' ? 'USD' : 'BDT',
        amountBdt: r.amountBdt,
        method: r.method,
        reference: r.reference
      })
    });
    if (resp.ok) { r.walletSent = true; await r.save(); return true; }
    console.error('wallet responded ' + resp.status);
  } catch (e) { console.error('wallet send failed: ' + e.message); }
  return false;
}
// retry anything the wallet has not received yet
setInterval(async () => {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const list = await Req.find({ walletSent: false, status: 'pending' }).limit(20);
    for (const r of list) await sendToWallet(r);
  } catch (e) { console.error('retry error: ' + e.message); }
}, 60000);

app.post('/api/deposit', needDb, auth, limit(10, 60000), ah(async (req, res) => {
  const { amount, method, trx } = req.body || {};
  const a = Number(amount);
  const u = req.user;
  const min = u.site === 'smm' ? 1 : 50;
  if (!(a >= min)) return res.status(400).json({ ok: false, msg: 'পরিমাণ কমপক্ষে ' + (u.site === 'smm' ? '$1' : '৳50') + ' দিন।' });
  if (!['bKash', 'Nagad'].includes(method)) return res.status(400).json({ ok: false, msg: 'পেমেন্ট মাধ্যম বেছে নিন।' });
  const ref = String(trx || '').trim();
  if (ref.length < 6 || ref.length > 40) return res.status(400).json({ ok: false, msg: 'সঠিক Transaction ID দিন।' });
  let r;
  try {
    r = await Req.create({
      user: u._id, username: u.username, site: u.site, type: 'deposit', amount: a,
      amountBdt: u.site === 'smm' ? Math.round(a * USD_RATE) : a, method, reference: ref
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ ok: false, msg: 'এই Transaction ID আগেই ব্যবহার হয়েছে।' });
    throw e;
  }
  sendToWallet(r);
  res.json({ ok: true, id: r._id, status: r.status });
}));

app.post('/api/withdraw', needDb, auth, limit(10, 60000), ah(async (req, res) => {
  const { amount, method, account } = req.body || {};
  const a = Number(amount);
  const u = req.user;
  if (u.site !== 'free') return res.status(400).json({ ok: false, msg: 'এই অ্যাকাউন্ট থেকে উইথড্র করা যায় না।' });
  if (!(a >= 200)) return res.status(400).json({ ok: false, msg: 'কমপক্ষে ৳২০০ উইথড্র করা যাবে।' });
  if (!['bKash', 'Nagad'].includes(method)) return res.status(400).json({ ok: false, msg: 'পেমেন্ট মাধ্যম বেছে নিন।' });
  if (!/^01\d{9}$/.test(String(account || ''))) return res.status(400).json({ ok: false, msg: 'সঠিক নাম্বার দিন (01XXXXXXXXX)।' });
  let doc = null;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const ok = await User.findOneAndUpdate({ _id: u._id, balance: { $gte: a } }, { $inc: { balance: -a } }, { session });
      if (!ok) { doc = null; return; }
      const made = await Req.create([{ user: u._id, username: u.username, site: u.site, type: 'withdraw', amount: a, amountBdt: a, method, reference: String(account) }], { session });
      doc = made[0];
    });
  } finally { session.endSession(); }
  if (!doc) return res.status(400).json({ ok: false, msg: 'ব্যালেন্স যথেষ্ট নয়।' });
  sendToWallet(doc);
  res.json({ ok: true, id: doc._id, status: doc.status });
}));

app.get('/api/requests', needDb, auth, ah(async (req, res) => {
  const list = await Req.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json({ ok: true, items: list.map((r) => ({ id: r._id, type: r.type, amount: r.amount, method: r.method, reference: r.reference, status: r.status, createdAt: r.createdAt })) });
}));

// live feed: only wallet-approved transactions, names masked
app.get('/api/live', needDb, ah(async (req, res) => {
  const list = await Req.find({ status: 'approved' }).sort({ doneAt: -1 }).limit(10);
  const mask = (n) => (n.length <= 4 ? n[0] + '***' : n.slice(0, 2) + '***' + n.slice(-2));
  res.json({ ok: true, items: list.map((r) => ({ name: mask(r.username), type: r.type, amountBdt: r.amountBdt, at: r.doneAt })) });
}));

// ================= Wallet: approve / reject comes back here =================
app.post('/api/wallet/webhook', needDb, ah(async (req, res) => {
  if (!WALLET_SECRET) return res.status(503).json({ ok: false, msg: 'webhook secret not set' });
  const given = String(req.headers['x-signature'] || '');
  const good = crypto.createHmac('sha256', WALLET_SECRET).update(req.rawBody || '').digest('hex');
  if (!given || !safeEq(given, good)) { console.log('WEBHOOK bad signature, ip=' + req.ip); return res.status(401).json({ ok: false }); }

  const { requestId, status } = req.body || {};
  if (!mongoose.isValidObjectId(requestId) || !['approved', 'rejected'].includes(status)) return res.status(400).json({ ok: false });

  let result = 'done';
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const r = await Req.findOneAndUpdate({ _id: requestId, status: 'pending' }, { status, doneAt: new Date() }, { session });
      if (!r) { result = 'skipped'; return; }
      const give = (r.type === 'deposit' && status === 'approved') || (r.type === 'withdraw' && status === 'rejected');
      if (give) await User.updateOne({ _id: r.user }, { $inc: { balance: r.amount } }, { session });
    });
  } finally { session.endSession(); }
  res.json({ ok: true, result });
}));

// ================= Pages =================
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
app.get('/health', (req, res) => res.json({
  ok: true,
  db: dbState,
  wallet: WALLET_URL && WALLET_KEY && WALLET_SECRET ? 'configured' : 'missing settings'
}));
app.get(['/admin', '/admin.html'], adminOnly, page('admin.html'));
app.get(['/smm', '/smm.html'], page('smm.html', true));
app.get(['/free', '/free.html'], page('free.html', true));
app.use(express.static(pub));

app.listen(PORT, () => console.log('EarnHub running on port ' + PORT));
