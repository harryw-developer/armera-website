// First-party page-view recording for the admin dashboard.
// No cookies, no IP address, no cross-site identifiers. The "session" is a
// random string kept in sessionStorage that is forgotten when the tab closes.
(function () {
  var cfg = window.ARMERA;

  // "Don't count my visits" on the privacy page. The choice is kept in this
  // browser so it can be honoured on every later visit.
  var OPT = 'armera_no_stats';
  function optedOut() { try { return localStorage.getItem(OPT) === '1'; } catch (e) { return false; } }
  (function wireOptOut() {
    var btn = document.getElementById('stats-optout');
    var state = document.getElementById('stats-optout-state');
    if (!btn) return;
    var paint = function () {
      var off = optedOut() || navigator.doNotTrack === '1';
      btn.textContent = optedOut() ? 'Count my visits again' : 'Don\u2019t count my visits';
      if (state) state.textContent = navigator.doNotTrack === '1' && !optedOut()
        ? 'Your browser\u2019s Do Not Track setting is on, so your visits are not counted.'
        : off ? 'Your visits are not being counted on this device.' : 'Your visits are currently counted, anonymously.';
    };
    btn.hidden = false;
    btn.addEventListener('click', function () {
      try {
        if (optedOut()) localStorage.removeItem(OPT);
        else { localStorage.setItem(OPT, '1'); sessionStorage.removeItem('armera_sid'); }
      } catch (e) {}
      paint();
    });
    paint();
  })();

  if (!cfg || navigator.doNotTrack === '1' || optedOut()) return;

  function sessionId() {
    try {
      var k = 'armera_sid', v = sessionStorage.getItem(k);
      if (!v) {
        v = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'nostore' + Math.random().toString(36).slice(2, 10); }
  }

  function device() {
    var w = window.innerWidth || 1280;
    return w < 768 ? 'mobile' : w < 1100 ? 'tablet' : 'desktop';
  }

  function referrerHost() {
    try {
      if (!document.referrer) return null;
      var h = new URL(document.referrer).hostname;
      return h === location.hostname ? null : h.slice(0, 120);
    } catch (e) { return null; }
  }

  function pathOf() {
    var p = location.pathname;
    if (cfg.base && p.indexOf(cfg.base) === 0) p = p.slice(cfg.base.length) || '/';
    return p.slice(0, 300);
  }

  // Work out what kind of page this is from the address.
  function derive() {
    var segs = pathOf().replace(/\/+$/, '').split('/').filter(Boolean);
    if (!segs.length) return { page_type: 'home' };
    if (segs[0] !== 'products') {
      var known = { inspiration: 'inspiration', about: 'about', retailers: 'retailers', support: 'support', contact: 'contact', admin: 'admin' };
      return { page_type: known[segs[0]] || 'other' };
    }
    if (segs.length === 1) return { page_type: 'products-index' };
    if (segs.length === 2) return { page_type: 'category', item_ref: segs[1] };
    if (segs.length === 3) return { page_type: 'range', item_ref: segs[2] };
    return { page_type: 'product', item_ref: segs[3] };
  }

  var sent = false;
  function send(extra) {
    if (sent) return;
    sent = true;
    var base = derive();
    var row = {
      path: pathOf(),
      page_type: (extra && extra.page_type) || base.page_type,
      item_ref: ((extra && extra.item_ref) || base.item_ref || null),
      item_name: (extra && extra.item_name) || null,
      referrer_host: referrerHost(),
      device: device(),
      session_id: sessionId()
    };
    if (row.item_ref) row.item_ref = String(row.item_ref).slice(0, 160);
    if (row.item_name) row.item_name = String(row.item_name).slice(0, 160);

    try {
      fetch(cfg.dataUrl + '/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row),
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* never let analytics break a page */ }
  }

  // Product/range pages render their content after fetching it, so they call
  // this themselves with the real names; everything else records straight away.
  window.armeraTrack = function (extra) { send(extra); };
  var segs = pathOf().replace(/\/+$/, '').split('/').filter(Boolean);
  var isCatalogPage = segs[0] === 'products' && segs.length > 1;
  if (segs[0] === 'admin') return;              // don't record your own admin visits
  if (!isCatalogPage) send();
  else setTimeout(function () { send(); }, 4000); // fallback if rendering stalls
})();
