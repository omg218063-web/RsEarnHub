(function () {
  function add() {
    var n = document.getElementById('nav');
    if (!n || n.querySelector('#gm-link')) return;
    var a = document.createElement('a');
    a.id = 'gm-link';
    a.href = '/admin-games';
    a.textContent = '🎮 গেম';
    a.style.cssText = 'flex:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#9aa0cf;font:600 15px "Hind Siliguri",sans-serif;padding:8px 14px;border-radius:12px;text-decoration:none;white-space:nowrap';
    n.appendChild(a);
  }
  add();
  var nv = document.getElementById('nav');
  if (nv) new MutationObserver(add).observe(nv, { childList: true });
})();
