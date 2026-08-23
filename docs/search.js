// Site-wide search. Builds an index the first time the overlay is opened,
// from the same Supabase content the rest of the site renders from.
(function () {
  var cfg = window.ARMERA;
  var overlay = document.getElementById('site-search');
  if (!cfg || !overlay) return;

  var input = document.getElementById('site-search-input');
  var out = document.getElementById('site-search-results');
  var index = null, building = null, lastQuery = '';

  var u = function (p) { return (cfg.base || '') + p; };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- index ---------- */
  var STATIC_PAGES = [
    { title: 'Inspiration', sub: 'Bathroom photography', href: '/inspiration/', kind: 'Page', terms: 'inspiration gallery photos ideas rooms' },
    { title: 'About ARMERA', sub: 'Our story, finishes and guarantees', href: '/about/', kind: 'Page', terms: 'about story finishes manufacturing guarantee wras sustainability' },
    { title: 'Find a retailer', sub: 'Stockists across the UK', href: '/retailers/', kind: 'Page', terms: 'retailer stockist showroom where to buy shop map' },
    { title: 'Support', sub: 'Spares, instructions and guarantees', href: '/support/', kind: 'Page', terms: 'support help spares guarantee register' },
    { title: 'Instructions', sub: 'Installation and product documents', href: '/support/instructions/', kind: 'Page', terms: 'instructions manuals installation pdf documents fitting' },
    { title: 'How-to videos', sub: 'Valve calibration, flow and temperature', href: '/support/how-to-videos/', kind: 'Page', terms: 'video how to calibrate flow temperature maintenance' },
    { title: 'Contact us', sub: '01225 251204 · info@armera.co.uk', href: '/contact/', kind: 'Page', terms: 'contact phone email address telephone' }
  ];

  function build() {
    if (index) return Promise.resolve(index);
    if (building) return building;
    building = Promise.all([
      fetch(cfg.supabaseUrl + '/rest/v1/site_content?select=key,data', {
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
      }).then(function (r) { return r.json(); }).catch(function () { return []; }),
      fetch(cfg.supabaseUrl + '/storage/v1/object/list/' + cfg.instructionsBucket, {
        method: 'POST',
        headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: '', limit: 500, sortBy: { column: 'name', order: 'asc' } })
      }).then(function (r) { return r.json(); }).catch(function () { return []; })
    ]).then(function (res) {
      var rows = res[0] || [], docs = res[1] || [];
      var items = [];

      rows.filter(function (r) { return /^\d\d-/.test(r.key); }).forEach(function (row) {
        var cat = row.data;
        items.push({ title: cat.name, sub: cat.ranges.length + ' ranges', href: '/products/' + cat.slug + '/', kind: 'Category', terms: cat.name });
        (cat.ranges || []).forEach(function (rg) {
          items.push({
            title: rg.title, sub: cat.name, href: '/products/' + cat.slug + '/' + rg.slug + '/',
            kind: 'Range', terms: [rg.name, rg.title, rg.tagline].join(' ')
          });
          (rg.products || []).forEach(function (p) {
            var skus = (p.variants || []).map(function (v) { return v.sku; }).join(' ');
            var fins = (p.variants || []).map(function (v) { return v.finish; }).join(' ');
            var prices = (p.variants || []).map(function (v) { return v.price; });
            var min = prices.length ? Math.min.apply(null, prices) : null;
            items.push({
              title: p.name, sub: rg.title + (min ? ' · from £' + min.toLocaleString('en-GB') : ''),
              href: '/products/' + cat.slug + '/' + rg.slug + '/' + p.slug + '/',
              kind: 'Product', img: p.image || null,
              terms: [p.name, rg.name, rg.title, cat.name, skus, fins, p.dims].join(' ')
            });
          });
        });
      });

      var vids = (rows.filter(function (r) { return r.key === 'videos'; })[0] || {}).data || [];
      (Array.isArray(vids) ? vids : []).forEach(function (v) {
        items.push({ title: v.title, sub: 'How-to video', href: '/support/how-to-videos/', kind: 'Video', terms: v.title });
      });

      var rets = (rows.filter(function (r) { return r.key === 'retailers'; })[0] || {}).data || [];
      (Array.isArray(rets) ? rets : []).forEach(function (r) {
        items.push({
          title: r.name, sub: [r.town, r.postcode].filter(Boolean).join(', '),
          href: '/retailers/', kind: 'Retailer',
          terms: [r.name, r.town, r.county, r.postcode].filter(Boolean).join(' ')
        });
      });

      (Array.isArray(docs) ? docs : []).filter(function (f) { return f && /\.pdf$/i.test(f.name); }).forEach(function (f) {
        var title = f.name.replace(/\.pdf$/i, '').replace(/^\s*\d+[\s._-]+/, '').replace(/_+/g, ' ').trim();
        items.push({
          title: title, sub: 'Instruction document', kind: 'Instructions',
          href: cfg.supabaseUrl + '/storage/v1/object/public/' + cfg.instructionsBucket + '/' + encodeURIComponent(f.name),
          external: true, terms: title + ' instructions manual installation'
        });
      });

      STATIC_PAGES.forEach(function (p) { items.push(p); });

      items.forEach(function (it) { it._hay = (it.title + ' ' + (it.terms || '')).toLowerCase(); });
      index = items;
      return index;
    });
    return building;
  }

  /* ---------- matching ---------- */
  var WEIGHT = { Product: 0, Range: 1, Category: 2, Instructions: 3, Video: 4, Retailer: 5, Page: 6 };

  function score(item, q) {
    var hay = item._hay, title = item.title.toLowerCase();
    if (title === q) return 100;
    if (title.indexOf(q) === 0) return 90;
    if (new RegExp('\\b' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(title)) return 80;
    if (title.indexOf(q) !== -1) return 65;
    if (hay.indexOf(q) !== -1) return 45;
    // every word present somewhere
    var words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every(function (w) { return hay.indexOf(w) !== -1; })) return 35;
    return 0;
  }

  function search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    return index.map(function (it) { return { it: it, s: score(it, q) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) {
        if (b.s !== a.s) return b.s - a.s;
        var wa = WEIGHT[a.it.kind] == null ? 9 : WEIGHT[a.it.kind];
        var wb = WEIGHT[b.it.kind] == null ? 9 : WEIGHT[b.it.kind];
        if (wa !== wb) return wa - wb;
        return a.it.title.localeCompare(b.it.title);
      })
      .slice(0, 60).map(function (r) { return r.it; });
  }

  /* ---------- rendering ---------- */
  function render(q) {
    if (!index) { out.innerHTML = '<p class="search-msg">Loading…</p>'; return; }
    if (q.trim().length < 2) {
      out.innerHTML = '<p class="search-msg">Start typing to search products, ranges, retailers, instructions and pages.</p>';
      return;
    }
    var hits = search(q);
    if (!hits.length) {
      out.innerHTML = '<p class="search-msg">Nothing found for “' + esc(q) + '”. Try a product name, a range, an order code or a town.</p>';
      return;
    }
    var groups = {}, order = [];
    hits.forEach(function (h) {
      if (!groups[h.kind]) { groups[h.kind] = []; order.push(h.kind); }
      groups[h.kind].push(h);
    });
    order.sort(function (a, b) {
      var wa = WEIGHT[a] == null ? 9 : WEIGHT[a], wb = WEIGHT[b] == null ? 9 : WEIGHT[b];
      return wa - wb;
    });
    var html = '<p class="search-count">' + hits.length + ' result' + (hits.length === 1 ? '' : 's') + '</p>';
    order.forEach(function (kind) {
      html += '<div class="search-group"><h3>' + esc(kind) + '</h3><div class="search-list">';
      groups[kind].forEach(function (it) {
        var href = it.external ? it.href : u(it.href);
        html += '<a class="search-hit" href="' + esc(href) + '"' + (it.external ? ' target="_blank" rel="noopener"' : '') + '>' +
          (it.img ? '<span class="shot"><img src="' + cfg.assets + '/products/' + encodeURIComponent(it.img) + '" alt="" loading="lazy"></span>' : '') +
          '<span class="txt"><span class="t">' + esc(it.title) + '</span>' +
          (it.sub ? '<span class="s">' + esc(it.sub) + '</span>' : '') + '</span></a>';
      });
      html += '</div></div>';
    });
    out.innerHTML = html;
  }

  /* ---------- open / close ---------- */
  function open() {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    input.focus();
    render(input.value);
    build().then(function () { render(input.value); });
  }
  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  Array.prototype.forEach.call(document.querySelectorAll('.js-search-open'), function (b) {
    b.addEventListener('click', function (e) { e.preventDefault(); open(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.js-search-close'), function (b) {
    b.addEventListener('click', close);
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    // "/" opens search, as long as you are not already typing somewhere
    if (e.key === '/' && !overlay.classList.contains('open')) {
      var t = e.target.tagName;
      if (t !== 'INPUT' && t !== 'TEXTAREA' && t !== 'SELECT' && !e.target.isContentEditable) { e.preventDefault(); open(); }
    }
  });
  var timer;
  input.addEventListener('input', function () {
    var q = input.value;
    if (q === lastQuery) return;
    lastQuery = q;
    clearTimeout(timer);
    timer = setTimeout(function () { render(q); }, 90);
  });
})();
