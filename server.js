const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const pub = path.join(__dirname, 'public');

let dbState = 'not configured';
if (process.env.MONGODB_URI) {
  mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => { dbState = 'connected'; })
    .catch((e) => { dbState = 'error: ' + e.message; });
}

function adminAuth(req, res, next) {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) return res.status(503).send('Set ADMIN_USER and ADMIN_PASS in Render.');
  const [type, token] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && token) {
    const [u, p] = Buffer.from(token, 'base64').toString().split(':');
    if (u === user && p === pass) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="EarnHub Admin"');
  res.status(401).send('Login required');
}

function page(name) {
  return (req, res) => {
    const f = path.join(pub, name);
    if (fs.existsSync(f)) return res.sendFile(f);
    res.status(404).send('This page is not added yet.');
  };
}

app.get('/health', (req, res) => res.json({ ok: true, db: dbState }));
app.get(['/admin', '/admin.html'], adminAuth, page('admin.html'));
app.get('/smm', page('smm.html'));
app.get('/free', page('free.html'));
app.use(express.static(pub));

app.listen(PORT, () => console.log('EarnHub running on port ' + PORT));
