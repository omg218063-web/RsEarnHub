// admin-api.js - আসল অ্যাডমিন প্যানেলের সার্ভার অংশ (শুধু অ্যাডমিন পাসওয়ার্ড দিয়ে ঢুকলে কাজ করে)
module.exports = function (app, d) {
  const { mongoose, User, Ledger, Order, Custom, Support, Config, getCfg, validAdminToken, getCookie, ah, needDb } = d;

  function adminApi(req, res, next) {
    if (validAdminToken(getCookie(req, 'eh_admin'))) return next();
    res.status(401).json({ ok: false, msg: 'অ্যাডমিন হিসেবে আবার লগইন করুন।' });
  }
  const guard = [needDb, adminApi];
  const rxEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const round2 = (n) => Math.round(n * 100) / 100;
  const dayStart = () => new Date(new Date(Date.now() + 6 * 36e5).toISOString().slice(0, 10) + 'T00:00:00+06:00');
  const STATUSES = ['Pending', 'Processing', 'Completed', 'Cancelled'];

  // ---------- ড্যাশবোর্ড ----------
  app.get('/api/admin/overview', guard, ah(async (req, res) => {
    const st = dayStart();
    const r = await Promise.all([
      User.countDocuments({}), User.countDocuments({ site: 'smm' }), User.countDocuments({ site: 'free' }),
      User.countDocuments({ banned: true }), User.countDocuments({ createdAt: { $gte: st } }),
      Order.countDocuments({ status: 'Pending' }), Order.countDocuments({ status: 'Processing' }), Order.countDocuments({ status: 'Completed' }),
      Support.countDocuments({}), Custom.countDocuments({}),
      User.find().sort({ createdAt: -1 }).limit(5).select('username site createdAt')
    ]);
    res.json({
      ok: true,
      users: { total: r[0], smm: r[1], free: r[2], banned: r[3], today: r[4] },
      orders: { pending: r[5], processing: r[6], completed: r[7] },
      messages: { support: r[8], custom: r[9] },
      recent: r[10].map((u) => ({ username: u.username, site: u.site, createdAt: u.createdAt }))
    });
  }));

  // ---------- ইউজার ----------
  app.get('/api/admin/users', guard, ah(async (req, res) => {
    const f = {};
    const q = String(req.query.q || '').trim().slice(0, 40);
    if (q) { const rx = new RegExp(rxEsc(q), 'i'); f.$or = [{ username: rx }, { phone: rx }]; }
    if (['smm', 'free'].includes(req.query.site)) f.site = req.query.site;
    const list = await User.find(f).sort({ createdAt: -1 }).limit(100).select('username phone site balance pkg earn banned createdAt');
    res.json({ ok: true, items: list.map((u) => ({ id: u._id, username: u.username, phone: u.phone, site: u.site, balance: u.balance, pkg: u.pkg, earn: u.earn, banned: !!u.banned, createdAt: u.createdAt })) });
  }));

  app.post('/api/admin/user', guard, ah(async (req, res) => {
    const { id, action } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, msg: 'ইউজার পাওয়া যায়নি।' });
    if (action === 'ban' || action === 'unban') {
      await User.updateOne({ _id: id }, { $set: { banned: action === 'ban' } });
      return res.json({ ok: true });
    }
    if (action === 'pkg') {
      const cfg = await getCfg();
      const p = Math.floor(Number(req.body.pkg));
      if (!(p >= 0 && p < cfg.pk.length)) return res.status(400).json({ ok: false, msg: 'প্যাকেজ ঠিক নেই।' });
      await User.updateOne({ _id: id, site: 'free' }, { $set: { pkg: p } });
      return res.json({ ok: true });
    }
    if (action === 'adjust') {
      const a = round2(Number(req.body.amount));
      if (!Number.isFinite(a) || a === 0 || Math.abs(a) > 1e7) return res.status(400).json({ ok: false, msg: 'সঠিক পরিমাণ দিন।' });
      const filter = { _id: id };
      if (a < 0) filter.balance = { $gte: -a };
      const u = await User.findOneAndUpdate(filter, { $inc: { balance: a } }, { new: true });
      if (!u) return res.status(400).json({ ok: false, msg: 'ইউজার নেই, অথবা ব্যালেন্স যথেষ্ট নয়।' });
      await Ledger.create({ user: id, delta: a, kind: 'admin', note: String(req.body.note || '').slice(0, 100) });
      return res.json({ ok: true, balance: u.balance });
    }
    res.status(400).json({ ok: false, msg: 'অজানা কাজ।' });
  }));

  // ---------- SMM অর্ডার ----------
  app.get('/api/admin/orders', guard, ah(async (req, res) => {
    const f = {};
    if (STATUSES.includes(req.query.status)) f.status = req.query.status;
    const list = await Order.find(f).sort({ createdAt: -1 }).limit(100);
    res.json({ ok: true, items: list.map((o) => ({ id: o._id, username: o.username, pf: o.pf, sv: o.sv, link: o.link, qty: o.qty, cost: o.cost, status: o.status, createdAt: o.createdAt })) });
  }));

  app.post('/api/admin/order', guard, ah(async (req, res) => {
    const { id, status } = req.body || {};
    if (!mongoose.isValidObjectId(id) || !STATUSES.includes(status)) return res.status(400).json({ ok: false, msg: 'ঠিক নেই।' });
    const o = await Order.findById(id);
    if (!o) return res.status(404).json({ ok: false, msg: 'অর্ডার পাওয়া যায়নি।' });
    if (o.status === status) return res.json({ ok: true });
    if (o.status === 'Cancelled' || o.status === 'Completed') return res.status(400).json({ ok: false, msg: 'শেষ হওয়া বা বাতিল অর্ডারের অবস্থা আর বদলানো যাবে না।' });
    if (status === 'Cancelled') {
      // বাতিল করলে টাকা ফেরত যায় (একবারই)
      const done = await Order.findOneAndUpdate({ _id: id, status: { $in: ['Pending', 'Processing'] } }, { status: 'Cancelled' }, { new: true });
      if (!done) return res.status(400).json({ ok: false, msg: 'এই অর্ডার বাতিল করা যাবে না।' });
      await User.updateOne({ _id: o.user }, { $inc: { balance: o.cost } });
      await Ledger.create({ user: o.user, delta: o.cost, kind: 'refund', note: 'order ' + o._id });
      return res.json({ ok: true, refunded: o.cost });
    }
    await Order.updateOne({ _id: id }, { $set: { status } });
    res.json({ ok: true });
  }));

  // ---------- কাস্টমার কেয়ার ও কাস্টম অর্ডারের মেসেজ ----------
  app.get('/api/admin/messages', guard, ah(async (req, res) => {
    const [s, c] = await Promise.all([Support.find().sort({ createdAt: -1 }).limit(100), Custom.find().sort({ createdAt: -1 }).limit(100)]);
    res.json({
      ok: true,
      support: s.map((x) => ({ id: x._id, username: x.username, message: x.message, createdAt: x.createdAt })),
      custom: c.map((x) => ({ id: x._id, username: x.username, text: x.text, link: x.link, budget: x.budget, createdAt: x.createdAt }))
    });
  }));
  app.post('/api/admin/message/delete', guard, ah(async (req, res) => {
    const { kind, id } = req.body || {};
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false });
    if (kind === 'support') await Support.deleteOne({ _id: id });
    else if (kind === 'custom') await Custom.deleteOne({ _id: id });
    else return res.status(400).json({ ok: false });
    res.json({ ok: true });
  }));

  // ---------- সাইটের সেটিংস ----------
  function bad(m) { const e = new Error(m); e.bad = true; return e; }
  const arr = (v, max) => { if (!Array.isArray(v)) throw bad('তালিকা ঠিক নেই।'); if (v.length > max) throw bad('তালিকা অনেক বড়।'); return v; };
  const num = (v, min, max, name) => { const n = Number(v); if (v === '' || !Number.isFinite(n) || n < min || n > max) throw bad((name || 'সংখ্যা') + ' ঠিক নেই।'); return n; };
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const need = (v, max, name) => { const s = str(v, max); if (!s) throw bad((name || 'নাম') + ' খালি রাখা যাবে না।'); return s; };
  const link = (v) => { const s = str(v, 500); if (!/^https?:\/\/\S+$/.test(s)) throw bad('লিংক https:// দিয়ে শুরু হতে হবে।'); return s; };

  function sanitize(i, cur) {
    const o = {};
    o.rate = num(i.rate, 1, 100000, 'ডলার রেট');
    o.tk = arr(i.tk, 60).map((t) => ({ t: t.t === 'vid' ? 'vid' : 'ad', n: need(t.n, 80, 'টাস্কের নাম'), l: link(t.l), on: t.on !== false }));
    if (o.tk.length < cur.tk.length) throw bad('টাস্ক মুছা যাবে না, বন্ধ করে রাখুন।');
    o.pk = arr(i.pk, 10).map((p) => ({ n: need(p.n, 30, 'প্যাকেজের নাম'), pr: num(p.pr, 0, 1e7, 'প্যাকেজের দাম'), lim: Math.floor(num(p.lim, 0, 1000, 'দৈনিক টাস্ক')), rw: num(p.rw, 0, 1e6, 'টাস্কের রিওয়ার্ড') }));
    if (o.pk.length < cur.pk.length) throw bad('প্যাকেজ কমানো যাবে না।');
    const bnIn = arr(i.bn, 10);
    o.bn = cur.bn.map((b) => { const x = bnIn.find((y) => y.k === b.k) || b; return { k: b.k, n: need(x.n, 40, 'বোনাসের নাম'), v: num(x.v, 0, 1e6, 'বোনাসের পরিমাণ'), h: num(x.h, 1, 8760, 'বোনাসের সময়') }; });
    o.vipMin = Math.floor(num(i.vipMin, 0, o.pk.length - 1, 'VIP প্যাকেজ'));
    const wv = arr(i.wv, 32).map((x) => num(x, 0, 1e6, 'স্পিনের পুরস্কার'));
    const ww = arr(i.ww, 32).map((x) => num(x, 0, 1e6, 'স্পিনের সম্ভাবনা'));
    if (wv.length < 2 || wv.length !== ww.length) throw bad('স্পিনের পুরস্কার ও সম্ভাবনার সংখ্যা সমান হতে হবে (কমপক্ষে ২টা)।');
    if (!ww.some((x) => x > 0)) throw bad('কমপক্ষে একটা ঘরের সম্ভাবনা ০-এর বেশি হতে হবে।');
    o.wv = wv; o.ww = ww;
    const rf = i.ref || {};
    o.ref = { su: num(rf.su, 0, 1e6, 'রেফারেল বোনাস'), pct: num(rf.pct, 0, 100, 'কমিশন') };
    o.bnr = arr(i.bnr, 20).map((b) => ({ t: need(b.t, 40, 'ব্যানারের নাম'), d: str(b.d, 100), c: Math.floor(num(b.c, 0, 3, 'রঙ')), on: b.on !== false }));
    o.pr = arr(i.pr, 60).map((p) => ({ n: need(p.n, 40, 'প্রমোশনের নাম'), d: str(p.d, 100), l: link(p.l), rw: num(p.rw, 0, 1e6, 'প্রমোশনের রিওয়ার্ড'), c: Math.floor(num(p.c, 0, 3, 'রঙ')), on: p.on !== false }));
    if (o.pr.length < cur.pr.length) throw bad('প্রমোশন মুছা যাবে না, বন্ধ করে রাখুন।');
    o.smm = arr(i.smm, 400).map((s) => ({ pf: need(s.pf, 40, 'প্ল্যাটফর্মের নাম'), sv: need(s.sv, 60, 'সার্ভিসের নাম'), p: num(s.p, 0, 1e6, 'সার্ভিসের দাম'), on: s.on !== false }));
    const s = i.set || {};
    o.set = { name: need(s.name, 40, 'সাইটের নাম'), bk: str(s.bk, 30), ng: str(s.ng, 30), minwd: num(s.minwd, 1, 1e7, 'সর্বনিম্ন উইথড্র'), mindep: num(s.mindep, 1, 1e7, 'সর্বনিম্ন ডিপোজিট') };
    return o;
  }

  app.get('/api/admin/config', guard, ah(async (req, res) => {
    res.json({ ok: true, cfg: await getCfg(true) });
  }));

  app.post('/api/admin/config', guard, ah(async (req, res) => {
    const cur = await getCfg(true);
    let clean;
    try { clean = sanitize((req.body || {}).cfg || {}, cur); }
    catch (e) { if (e.bad) return res.status(400).json({ ok: false, msg: e.message }); throw e; }
    await Config.updateOne({ key: 'main' }, { $set: { data: Object.assign({}, cur, clean) } }, { upsert: true });
    await getCfg(true);
    res.json({ ok: true });
  }));

  console.log('অ্যাডমিন API প্রস্তুত');
};
