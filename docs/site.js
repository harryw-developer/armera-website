// ARMERA site interactions + editable-content overrides
(function () {
  // mobile menu
  var burger = document.querySelector('.burger');
  var menu = document.querySelector('.mobile-menu');
  if (burger && menu) {
    burger.addEventListener('click', function () { menu.classList.add('open'); document.body.style.overflow = 'hidden'; });
    menu.querySelector('.close').addEventListener('click', function () { menu.classList.remove('open'); document.body.style.overflow = ''; });
  }

  // inspiration lightbox
  var figures = Array.prototype.slice.call(document.querySelectorAll('.masonry figure'));
  var lightbox = document.querySelector('.lightbox');
  if (figures.length && lightbox) {
    var lbImg = lightbox.querySelector('img');
    var idx = 0;
    var show = function (i) {
      idx = (i + figures.length) % figures.length;
      lbImg.src = figures[idx].querySelector('img').getAttribute('data-full') || figures[idx].querySelector('img').src;
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    var hide = function () { lightbox.classList.remove('open'); document.body.style.overflow = ''; };
    figures.forEach(function (f, i) { f.addEventListener('click', function () { show(i); }); });
    lightbox.querySelector('.x').addEventListener('click', hide);
    lightbox.querySelector('.prev').addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
    lightbox.querySelector('.next').addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) hide(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') hide();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
  }

  // editable text blocks + catalogue links (stored in Supabase site_content 'pages')
  var cfg = window.ARMERA;
  var marked = document.querySelectorAll('[data-ck], [data-ck-sections], [data-catalogue], [data-catalogue-title], [data-catalogue-cover]');
  if (!cfg || !marked.length) return;

  fetch(cfg.supabaseUrl + '/rest/v1/site_content?key=eq.pages&select=data', {
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
  }).then(function (r) { return r.json(); }).then(function (rows) {
    var pages = rows && rows[0] && rows[0].data;
    if (!pages) return;

    // News banner across the top of the homepage (homepage only).
    var banner = document.getElementById('news-banner');
    if (banner) {
      var b = pages.banner || {};
      if (b.on && b.text) {
        var textEl = document.getElementById('news-banner-text');
        textEl.textContent = b.text;
        if (b.bg) banner.style.background = b.bg;
        if (b.fg) banner.style.color = b.fg;
        if (b.font === 'custom' && b.fontFile) {
          var url = cfg.assets + '/fonts/' + encodeURIComponent(b.fontFile);
          var ext = (b.fontFile.split('.').pop() || '').toLowerCase();
          var fmt = ext === 'woff2' ? 'woff2' : ext === 'woff' ? 'woff' : ext === 'otf' ? 'opentype' : 'truetype';
          var st = document.createElement('style');
          st.textContent = "@font-face{font-family:'ArmeraBanner';src:url('" + url + "') format('" + fmt + "');font-display:swap}";
          document.head.appendChild(st);
          textEl.style.fontFamily = "'ArmeraBanner', " + getComputedStyle(document.body).fontFamily;
        }
        if (b.size) textEl.style.fontSize = b.size + 'px';
        banner.hidden = false;
      }
    }

    // Homepage hero: a photograph or a looping video, whichever is set.
    var heroMedia = document.getElementById('hero-media');
    if (heroMedia && pages.home && pages.home.hero && pages.home.hero.file) {
      var h = pages.home.hero;
      var src = cfg.assets + '/' + (h.file.indexOf('/') === -1 ? 'lifestyle/' : '') +
        h.file.split('/').map(encodeURIComponent).join('/');
      if (h.type === 'video') {
        var v = document.createElement('video');
        v.id = 'hero-media';
        v.src = src;
        v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.setAttribute('aria-label', h.alt || 'ARMERA bathroomware');
        if (h.poster) v.poster = cfg.assets + '/' + (h.poster.indexOf('/') === -1 ? 'lifestyle/' : '') +
          h.poster.split('/').map(encodeURIComponent).join('/');
        heroMedia.parentNode.replaceChild(v, heroMedia);
      } else {
        heroMedia.src = src;
        if (h.alt) heroMedia.alt = h.alt;
      }
    }

    // Catalogue: one upload in the admin re-points every link, title and cover.
    var cat = pages.catalogue;
    if (cat && cat.file) {
      var href = cfg.assets + '/documents/' + encodeURIComponent(cat.file);
      Array.prototype.forEach.call(document.querySelectorAll('[data-catalogue]'), function (a) {
        a.setAttribute('href', href);
      });
      if (cat.label) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-catalogue-title]'), function (t) {
          t.textContent = cat.label;
        });
      }
      if (cat.cover) {
        Array.prototype.forEach.call(document.querySelectorAll('[data-catalogue-cover]'), function (ph) {
          var img = document.createElement('img');
          img.src = cfg.assets + '/documents/' + encodeURIComponent(cat.cover);
          img.alt = (cat.label || 'ARMERA') + ' catalogue cover';
          img.loading = 'lazy';
          ph.parentNode.replaceChild(img, ph);
        });
      }
    }
    var get = function (key) {
      return key.split('.').reduce(function (o, k) { return o && o[k]; }, pages);
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-ck]'), function (el) {
      var v = get(el.getAttribute('data-ck'));
      if (typeof v !== 'string' || !v) return;
      el.textContent = v;
      if (el.tagName === 'A') {
        if (/^tel:/.test(el.getAttribute('href') || '')) el.setAttribute('href', 'tel:' + v.replace(/\s+/g, ''));
        if (/^mailto:/.test(el.getAttribute('href') || '')) el.setAttribute('href', 'mailto:' + v.trim());
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-ck-sections]'), function (el) {
      var sections = get(el.getAttribute('data-ck-sections'));
      if (!Array.isArray(sections) || !sections.length) return;
      el.innerHTML = '';
      sections.forEach(function (s) {
        var grid = document.createElement('div');
        grid.className = 'about-grid';
        var side = document.createElement('div');
        side.className = 'side';
        side.textContent = s.side || '';
        var body = document.createElement('div');
        body.className = 'body';
        (s.paras || []).forEach(function (t) {
          var p = document.createElement('p');
          p.textContent = t;
          body.appendChild(p);
        });
        grid.appendChild(side);
        grid.appendChild(body);
        el.appendChild(grid);
      });
    });
  }).catch(function () { /* static fallback text remains */ });
})();
