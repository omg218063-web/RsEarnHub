(function () {
  var LK = 'eh_gate_lock';
  function lockLeft() { try { return Math.max(0, (+localStorage.getItem(LK) || 0) - Date.now()); } catch (e) { return 0; } }
  function setLock(sec) { try { localStorage.setItem(LK, String(Date.now() + sec * 1000)); } catch (e) {} }
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var st = document.createElement('style');
  st.textContent =
    '#gate-ov{position:fixed;inset:0;background:#020312ee;display:none;align-items:center;justify-content:center;z-index:99;padding:20px}' +
    '#gate-ov.on{display:flex}' +
    '#gate-ov .gb{width:100%;max-width:380px;background:#181b4a;border:1px solid #ff6b8a88;border-radius:22px;padding:22px;color:#eef0ff;font-family:"Hind Siliguri",system-ui,sans-serif;box-shadow:0 0 40px #ff6b8a33}' +
    '#gate-ov h3{margin:0 0 8px;font-size:20px;color:#ff8aa8}' +
    '#gate-ov .gw{margin:0 0 12px;font-size:14px;color:#ffc9d4;line-height:1.5}' +
    '#gate-ov input{width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:#0a0c2e;color:#eef0ff;font:16px inherit;box-sizing:border-box}' +
    '#gate-ov .ge{color:#ff8aa8;font-size:14px;min-height:20px;margin:8px 0 0;font-weight:600}' +
    '#gate-ov .gt{color:#ffc93c;font-size:15px;margin:4px 0 8px;font-weight:700}' +
    '#gate-ov .gbtn{width:100%;margin-top:10px;border:0;border-radius:12px;padding:12px;font:600 16px inherit;cursor:pointer;background:#2de2e6;color:#06112a}' +
    '#gate-ov .gx{background:rgba(255,255,255,.08);color:#eef0ff}' +
    '#adm-link button{background:none;border:0;color:#9aa0cf;font:13px "Hind Siliguri",sans-serif;text-decoration:underline;cursor:pointer;padding:8px}';
  document.head.appendChild(st);

  var ov = document.createElement('div');
  ov.id = 'gate-ov';
  ov.setAttribute('role', 'dialog');
  ov.innerHTML =
    '<div class="gb"><h3>⚠️ সীমিত প্রবেশাধিকার</h3>' +
    '<p class="gw">এই অংশ শুধু অনুমোদিত অ্যাডমিনের জন্য। অনুমতি ছাড়া ঢোকার চেষ্টা করা নিষিদ্ধ এবং প্রতিটা চেষ্টা রেকর্ড করা হয়।</p>' +
    '<input id="gp" type="password" placeholder="অ্যাডমিন পাসওয়ার্ড" autocomplete="off">' +
    '<div id="ge" class="ge" role="alert"></div><div id="gt" class="gt"></div>' +
    '<button id="gok" class="gbtn">প্রবেশ করুন</button><button id="gx" class="gbtn gx">বাতিল</button></div>';
  document.body.appendChild(ov);

  var timer = null;
  function err(m) { $('ge').textContent = m; }
  function tick() {
    var l = lockLeft();
    if (l <= 0) { clearInterval(timer); timer = null; $('gt').textContent = ''; return; }
    var s = Math.ceil(l / 1000);
    $('gt').textContent = '🔒 লক করা আছে। আবার চেষ্টা করা যাবে: ' + pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }
  function startTimer() { tick(); if (!timer && lockLeft() > 0) timer = setInterval(tick, 1000); }

  function openGate() {
    ov.classList.add('on');
    $('gp').value = '';
    err('');
    if (lockLeft() > 0) {
      err('⛔ সতর্কতা! আপনার প্রবেশ লক করা আছে। অনুমতি ছাড়া বারবার চেষ্টা নিষিদ্ধ।');
      startTimer();
    }
  }

  $('gx').onclick = function () { ov.classList.remove('on'); };
  $('gok').onclick = function () {
    if (lockLeft() > 0) {
      err('⛔ সতর্কতা! অনুমতি ছাড়া বারবার প্রবেশের চেষ্টা নিষিদ্ধ। প্রতিটা চেষ্টা রেকর্ড হচ্ছে।');
      startTimer();
      return;
    }
    var p = $('gp').value;
    if (!p) { err('পাসওয়ার্ড লিখুন।'); return; }
    fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: p })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { location.href = '/admin'; return; }
        if (j.locked) {
          setLock(j.retryAfter || 3600);
          err('⛔ সতর্কতা! অনেকবার ভুল পাসওয়ার্ড। ১ ঘণ্টার জন্য লক করা হলো। অননুমোদিত প্রবেশের চেষ্টা রেকর্ড করা হয়েছে।');
          startTimer();
          return;
        }
        err('⚠️ ভুল পাসওয়ার্ড! সতর্কতা: অননুমোদিত প্রবেশের চেষ্টা রেকর্ড করা হচ্ছে।' + (j.left ? ' আর ' + j.left + ' বার ভুল হলে ১ ঘণ্টার জন্য লক হবে।' : ''));
        $('gp').value = '';
      })
      .catch(function () { err('সার্ভারে সমস্যা, আবার চেষ্টা করুন।'); });
  };

  var view = document.getElementById('view');
  function check() {
    if (view.querySelector('#pf') && !view.querySelector('#adm-link')) {
      var d = document.createElement('div');
      d.id = 'adm-link';
      d.style.cssText = 'text-align:center;margin:22px 0 6px';
      d.innerHTML = '<button type="button">অ্যাডমিন প্যানেল</button>';
      d.firstChild.onclick = openGate;
      view.appendChild(d);
    }
  }
  if (view) {
    new MutationObserver(check).observe(view, { childList: true });
    check();
  }
})();
