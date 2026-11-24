// games-api.js - ফ্রি স্কিল গেম ও সাপ্তাহিক টুর্নামেন্ট
// নিয়ম: এন্ট্রি ফ্রি, কোনো বাজি নেই, শুধু দক্ষতার খেলা। সপ্তাহ শেষে সেরা খেলোয়াড়রা রেড ডায়মন্ড পুরস্কার পায়।
const crypto = require('crypto');

const GAMES = {
  memory: { name: 'মেমোরি ম্যাচ', icon: '🧠' },
  quiz: { name: 'কুইজ রাশ', icon: '❓' },
  coin: { name: 'কয়েন ক্যাচার', icon: '🪙' },
  tap: { name: 'ট্যাপ রাশ', icon: '⚡' }
};

const DEF = {
  on: true,
  attempts: 5,                                         // প্রতি গেমে দিনে কতবার খেলা যাবে
  minPlays: 3,                                         // পুরস্কারের জন্য সপ্তাহে কমপক্ষে কতবার খেলতে হবে
  prizes: [100, 60, 40, 20, 20, 10, 10, 10, 10, 10],   // রেড ডায়মন্ড, ১ম থেকে ১০ম
  games: { memory: true, quiz: true, coin: true, tap: true }
};

// [প্রশ্ন, সঠিক উত্তর, ভুল১, ভুল২, ভুল৩]
const BANK = [
  ['বাংলাদেশের রাজধানীর নাম কী?', 'ঢাকা', 'চট্টগ্রাম', 'রাজশাহী', 'সিলেট'],
  ['বাংলাদেশের জাতীয় ফুল কোনটি?', 'শাপলা', 'গোলাপ', 'জবা', 'বেলি'],
  ['বাংলাদেশের জাতীয় পাখি কোনটি?', 'দোয়েল', 'কাক', 'ময়না', 'শালিক'],
  ['বাংলাদেশের জাতীয় ফল কোনটি?', 'কাঁঠাল', 'আম', 'লিচু', 'কলা'],
  ['বাংলাদেশের স্বাধীনতা দিবস কবে?', '২৬ মার্চ', '১৬ ডিসেম্বর', '২১ ফেব্রুয়ারি', '১৪ এপ্রিল'],
  ['বিজয় দিবস কবে?', '১৬ ডিসেম্বর', '২৬ মার্চ', '২১ ফেব্রুয়ারি', '১৫ আগস্ট'],
  ['আন্তর্জাতিক মাতৃভাষা দিবস কবে?', '২১ ফেব্রুয়ারি', '৮ মার্চ', '১ মে', '২৬ মার্চ'],
  ['পৃথিবীর বৃহত্তম মহাসাগর কোনটি?', 'প্রশান্ত মহাসাগর', 'আটলান্টিক মহাসাগর', 'ভারত মহাসাগর', 'আর্কটিক মহাসাগর'],
  ['সপ্তাহে কয়টি দিন?', '৭', '৫', '৬', '৮'],
  ['এক বছরে কয়টি মাস?', '১২', '১০', '১১', '১৩'],
  ['১২ × ১২ = কত?', '১৪৪', '১২০', '১৩২', '১৫৬'],
  ['১০০ ÷ ৪ = কত?', '২৫', '২০', '৩০', '৪০'],
  ['১৫ + ২৭ = কত?', '৪২', '৪১', '৪৩', '৪৫'],
  ['৯ × ৭ = কত?', '৬৩', '৫৬', '৭২', '৫৪'],
  ['সূর্য কোন দিকে ওঠে?', 'পূর্ব', 'পশ্চিম', 'উত্তর', 'দক্ষিণ'],
  ['পানির রাসায়নিক সংকেত কোনটি?', 'H₂O', 'CO₂', 'O₂', 'NaCl'],
  ['প্রাপ্তবয়স্ক মানুষের দেহে হাড় কয়টি?', '২০৬', '২০০', '২১৬', '১৯৬'],
  ['সৌরজগতের বৃহত্তম গ্রহ কোনটি?', 'বৃহস্পতি', 'শনি', 'পৃথিবী', 'মঙ্গল'],
  ['পৃথিবীর সবচেয়ে কাছের নক্ষত্র কোনটি?', 'সূর্য', 'চাঁদ', 'মঙ্গল', 'শুক্র'],
  ['বাংলাদেশের জাতীয় কবি কে?', 'কাজী নজরুল ইসলাম', 'রবীন্দ্রনাথ ঠাকুর', 'জসীমউদ্দীন', 'জীবনানন্দ দাশ'],
  ['গীতাঞ্জলি কার রচনা?', 'রবীন্দ্রনাথ ঠাকুর', 'কাজী নজরুল ইসলাম', 'শরৎচন্দ্র চট্টোপাধ্যায়', 'বঙ্কিমচন্দ্র চট্টোপাধ্যায়'],
  ['বাংলাদেশের মুদ্রার নাম কী?', 'টাকা', 'রুপি', 'ডলার', 'রিয়াল'],
  ['আয়তনে বাংলাদেশের বৃহত্তম জেলা কোনটি?', 'রাঙামাটি', 'ঢাকা', 'চট্টগ্রাম', 'খুলনা'],
  ['বিশ্বের দীর্ঘতম সমুদ্রসৈকত কোথায় (বাংলাদেশে)?', 'কক্সবাজার', 'কুয়াকাটা', 'সেন্টমার্টিন', 'পতেঙ্গা'],
  ['ঈদুল ফিতর কোন মাসের রোজার পর আসে?', 'রমজান', 'মহররম', 'শাবান', 'রজব'],
  ['এক ঘণ্টায় কত মিনিট?', '৬০', '৩০', '১০০', '১২০'],
  ['একটি ত্রিভুজের তিন কোণের সমষ্টি কত?', '১৮০°', '৯০°', '২৭০°', '৩৬০°'],
  ['কোন প্রাণীকে "জঙ্গলের রাজা" বলা হয়?', 'সিংহ', 'হাতি', 'ভাল্লুক', 'জিরাফ'],
  ['সুন্দরবন কোন প্রাণীর জন্য বিখ্যাত?', 'রয়েল বেঙ্গল টাইগার', 'সিংহ', 'জিরাফ', 'জেব্রা'],
  ['রামধনুতে কয়টি রং?', '৭', '৫', '৬', '৮'],
  ['২ এর ঘনফল (২ × ২ × ২) কত?', '৮', '৬', '৪', '১২'],
  ['ইংরেজি বর্ণমালায় কয়টি অক্ষর?', '২৬', '২৪', '২৮', '৩০'],
  ['সাধারণ বছরে কয়দিন?', '৩৬৫', '৩৬০', '৩৬৬', '৩৫৫'],
  ['ফুটবলে মাঠে এক দলের কয়জন খেলোয়াড় থাকে?', '১১', '১০', '১২', '৯'],
  ['ক্রিকেটে এক ওভারে সাধারণত কয়টি বল?', '৬', '৫', '৮', '১০'],
  ['কম্পিউটারের "মস্তিষ্ক" কোনটিকে বলা হয়?', 'CPU', 'RAM', 'মাউস', 'মনিটর']
];

// ঢাকার সময় অনুযায়ী সপ্তাহ (সোমবার থেকে রবিবার)
function weekStart(ts) {
  const d = new Date((ts || Date.now()) + 6 * 36e5);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
}
const weekKey = (ts) => weekStart(ts).toISOString().slice(0, 10);
const weekEndMs = (ts) => weekStart(ts).getTime() + 7 * 864e5 - 6 * 36e5;

// সার্ভার নিজে স্কোর হিসাব করে ও সন্দেহজনক ফলাফল বাদ দেয় (ক্লায়েন্টের পাঠানো স্কোর বিশ্বাস করা হয় না)
function judge(g, play, b, el) {
  const bad = { err: 'খেলার ফলাফল ঠিক নেই, স্কোর গ্রহণ হয়নি।' };
  const fast = { err: 'খেলার সময় সন্দেহজনক, স্কোর গ্রহণ হয়নি।' };
  if (g === 'memory') {
    const moves = Math.floor(Number(b.moves));
    if (!(moves >= 8 && moves <= 300)) return bad;
    if (el < Math.max(8, moves * 0.35)) return fast;
    if (el > 900) return { err: 'সময় অনেক বেশি লেগেছে, স্কোর গ্রহণ হয়নি।' };
    return { score: Math.max(10, Math.round(1000 - moves * 12 - el * 6)) };
  }
  if (g === 'quiz') {
    const ans = Array.isArray(b.answers) ? b.answers : [];
    const key = (play.key && play.key.ans) || [];
    if (!key.length || ans.length !== key.length) return bad;
    if (el < key.length * 1.5) return fast;
    if (el > 600) return { err: 'সময় অনেক বেশি লেগেছে, স্কোর গ্রহণ হয়নি।' };
    let c = 0;
    ans.forEach((x, i) => { if (Number(x) === key[i]) c++; });
    const bonus = c >= 5 ? Math.max(0, Math.min(80, Math.round(100 - el))) : 0;
    return { score: c * 100 + bonus };
  }
  if (g === 'coin') {
    const coins = Math.floor(Number(b.coins)), bombs = Math.floor(Number(b.bombs));
    if (!(coins >= 0 && coins <= 130 && bombs >= 0 && bombs <= 60)) return bad;
    if (el < 27 || el > 70) return fast;
    return { score: Math.max(0, coins * 10 - bombs * 30) };
  }
  if (g === 'tap') {
    const hits = Math.floor(Number(b.hits)), misses = Math.floor(Number(b.misses));
    if (!(hits >= 0 && hits <= 150 && misses >= 0 && misses <= 300)) return bad;
    if (el < 17 || el > 50) return fast;
    return { score: Math.max(0, hits * 10 - misses * 5) };
  }
  return bad;
}

module.exports = function (app, d) {
  const { mongoose, User, Ledger, Config, getCfg, auth, onlySite, limit, needDb, ah, dayKey, mask, incFor } = d;
  const ObjectId = mongoose.Schema.Types.ObjectId;
  const Mixed = mongoose.Schema.Types.Mixed;
  const rnd = (n) => crypto.randomInt(0, n);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  let gc = null, gcAt = 0;
  async function gcfg() {
    if (gc && Date.now() - gcAt < 30000) return gc;
    const row = await Config.findOne({ key: 'games' });
    gc = Object.assign({}, DEF, row && row.data ? row.data : {});
    gcAt = Date.now();
    return gc;
  }

  const Play = mongoose.model('GamePlay', new mongoose.Schema({
    user: ObjectId, game: String, week: String, token: { type: String, unique: true }, startedAt: Date,
    done: { type: Boolean, default: false }, key: Mixed, at: { type: Date, default: Date.now, expires: 172800 }
  }));
  const dayS = new mongoose.Schema({ user: ObjectId, game: String, day: String, n: { type: Number, default: 0 } });
  dayS.index({ user: 1, game: 1, day: 1 }, { unique: true });
  const Day = mongoose.model('GameDay', dayS);
  const scoreS = new mongoose.Schema({ user: ObjectId, username: String, game: String, week: String, best: Number, plays: { type: Number, default: 0 }, at: Date });
  scoreS.index({ game: 1, week: 1, user: 1 }, { unique: true });
  scoreS.index({ game: 1, week: 1, best: -1 });
  const Score = mongoose.model('GameScore', scoreS);
  const setS = new mongoose.Schema({ game: String, week: String, paid: Mixed, at: { type: Date, default: Date.now } });
  setS.index({ game: 1, week: 1 }, { unique: true });
  const Settled = mongoose.model('GameSettled', setS);

  const enabled = (g, c) => GAMES[g] && c.on && c.games[g] !== false;
  const rankOf = async (g, wk, best) => (await Score.countDocuments({ game: g, week: wk, best: { $gt: best } })) + 1;

  // ---------- লবি: সব গেম, বাকি সুযোগ, নিজের সেরা স্কোর ----------
  app.get('/api/game/info', needDb, auth, onlySite('free'), limit(60, 60000), ah(async (req, res) => {
    settle().catch(() => {});
    const c = await gcfg();
    const day = dayKey(), wk = weekKey();
    const out = [];
    for (const g of Object.keys(GAMES)) {
      if (!enabled(g, c)) continue;
      const dd = await Day.findOne({ user: req.user._id, game: g, day });
      const mine = await Score.findOne({ game: g, week: wk, user: req.user._id });
      out.push({ id: g, name: GAMES[g].name, icon: GAMES[g].icon, left: Math.max(0, c.attempts - (dd ? dd.n : 0)), best: mine ? mine.best : 0, plays: mine ? mine.plays : 0, rank: mine ? await rankOf(g, wk, mine.best) : null });
    }
    res.json({ ok: true, games: out, attempts: c.attempts, minPlays: c.minPlays, prizes: c.prizes, endsAt: weekEndMs() });
  }));

  // ---------- লিডারবোর্ড ----------
  app.get('/api/game/board', needDb, auth, onlySite('free'), limit(60, 60000), ah(async (req, res) => {
    const g = String(req.query.game || '');
    if (!GAMES[g]) return res.status(400).json({ ok: false, msg: 'গেম পাওয়া যায়নি।' });
    const wk = weekKey();
    const top = await Score.find({ game: g, week: wk }).sort({ best: -1, at: 1 }).limit(10);
    const mine = await Score.findOne({ game: g, week: wk, user: req.user._id });
    res.json({
      ok: true,
      top: top.map((x) => ({ name: mask(x.username), best: x.best, plays: x.plays, me: String(x.user) === String(req.user._id) })),
      me: mine ? { best: mine.best, plays: mine.plays, rank: await rankOf(g, wk, mine.best) } : null
    });
  }));

  // ---------- খেলা শুরু ----------
  app.post('/api/game/start', needDb, auth, onlySite('free'), limit(30, 60000), ah(async (req, res) => {
    const g = String((req.body || {}).game || '');
    const c = await gcfg();
    if (!enabled(g, c)) return res.status(400).json({ ok: false, msg: 'এই গেম এখন বন্ধ আছে।' });
    const day = dayKey();
    let left;
    try {
      const r = await Day.findOneAndUpdate({ user: req.user._id, game: g, day, n: { $lt: c.attempts } }, { $inc: { n: 1 } }, { upsert: true, new: true });
      left = c.attempts - r.n;
    } catch (e) {
      if (e.code === 11000) return res.status(400).json({ ok: false, msg: 'আজকের খেলার সুযোগ শেষ, কাল আবার খেলুন।' });
      throw e;
    }
    const token = crypto.randomBytes(16).toString('hex');
    let key = {}, payload = {};
    if (g === 'memory') {
      payload.cards = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]);
    } else if (g === 'quiz') {
      const idx = shuffle(BANK.map((_, i) => i)).slice(0, 8);
      const ans = [];
      payload.questions = idx.map((i) => {
        const row = BANK[i];
        const opts = shuffle(row.slice(1));
        ans.push(opts.indexOf(row[1]));
        return { q: row[0], o: opts };
      });
      key = { ans };
    } else if (g === 'coin') payload.secs = 30;
    else payload.secs = 20;
    await Play.create({ user: req.user._id, game: g, week: weekKey(), token, startedAt: new Date(), key });
    res.json(Object.assign({ ok: true, token, left }, payload));
  }));

  // ---------- খেলা শেষ ----------
  app.post('/api/game/finish', needDb, auth, onlySite('free'), limit(30, 60000), ah(async (req, res) => {
    const b = req.body || {};
    const play = await Play.findOneAndUpdate({ token: String(b.token || ''), user: req.user._id, done: { $ne: true } }, { $set: { done: true } });
    if (!play) return res.status(400).json({ ok: false, msg: 'এই খেলা আগেই শেষ হয়েছে বা পাওয়া যায়নি।' });
    const el = (Date.now() - play.startedAt.getTime()) / 1000;
    const v = judge(play.game, play, b, el);
    if (v.err) return res.status(400).json({ ok: false, msg: v.err });
    const wk = weekKey();
    const sc = await Score.findOneAndUpdate(
      { game: play.game, week: wk, user: req.user._id },
      { $max: { best: v.score }, $inc: { plays: 1 }, $set: { username: req.user.username, at: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ ok: true, game: play.game, score: v.score, best: sc.best, plays: sc.plays, rank: await rankOf(play.game, wk, sc.best) });
  }));

  // ---------- সপ্তাহ শেষে পুরস্কার (রেড ডায়মন্ড, প্রতি গেম ও সপ্তাহে একবারই) ----------
  async function settle() {
    if (mongoose.connection.readyState !== 1) return;
    const cur = weekKey();
    const weeks = (await Score.distinct('week')).filter((w) => w < cur);
    if (!weeks.length) return;
    const c = await gcfg();
    const cfg = await getCfg();
    for (const wk of weeks) {
      for (const g of Object.keys(GAMES)) {
        if (await Settled.exists({ game: g, week: wk })) continue;
        const list = await Score.find({ game: g, week: wk, plays: { $gte: c.minPlays } }).sort({ best: -1, at: 1 }).limit(c.prizes.length);
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await Settled.create([{ game: g, week: wk, paid: list.map((s, i) => ({ user: s.user, rank: i + 1, prize: c.prizes[i] })) }], { session });
            for (let i = 0; i < list.length; i++) {
              const prize = Number(c.prizes[i]) || 0;
              if (prize <= 0 || !(list[i].best > 0)) continue;
              await User.updateOne({ _id: list[i].user }, { $inc: incFor('red', prize, cfg) }, { session });
              await Ledger.create([{ user: list[i].user, delta: prize, kind: 'tournament', note: g + ' ' + wk + ' #' + (i + 1), earn: true, cur: 'red' }], { session });
            }
          });
        } catch (e) {
          if (e.code !== 11000) console.error('[টুর্নামেন্ট] পুরস্কার দেওয়া যায়নি: ' + e.message);
        } finally { session.endSession(); }
      }
    }
  }
  setInterval(() => settle().catch(() => {}), 10 * 60 * 1000);
  setTimeout(() => settle().catch(() => {}), 20000);

  console.log('গেম API প্রস্তুত');
};
module.exports.helpers = { weekKey, weekEndMs, judge, BANK, GAMES };
