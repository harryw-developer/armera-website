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

  /* ---------------- homepage hero ----------------
     The build bakes the chosen media into the page, so the browser fetches
     exactly the right file and nothing else. This keeps the photographs
     sliding — one every five seconds — and rebuilds the stack only if the
     admin has changed it since the site was last built. It runs on what is
     baked in first, so the slideshow works even if Supabase is unreachable. */
  var heroTimer = null;

  function heroAssetUrl(f) {
    var p = f.indexOf('/') === -1 ? 'lifestyle/' + f : f;
    return cfg.assets + '/' + p.split('/').map(encodeURIComponent).join('/');
  }

  function setupHero(h) {
    var host = document.getElementById('hero-media');
    if (!host) return;
    h = h || {};

    if (h.type === 'video' && h.file) {
      if (host.tagName !== 'VIDEO' || host.getAttribute('data-hero-file') !== h.file) {
        var v = document.createElement('video');
        v.id = 'hero-media';
        v.setAttribute('data-hero-file', h.file);
        v.src = heroAssetUrl(h.file);
        v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.preload = 'auto';
        v.setAttribute('aria-label', h.alt || 'ARMERA bathroomware');
        if (h.poster) v.poster = heroAssetUrl(h.poster);
        if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
        host.parentNode.replaceChild(v, host);
        nudgeVideo(v);
      }
      return;
    }
    if (host.tagName === 'VIDEO') return;   // a video is baked in and no photos are set

    var files = (h.files && h.files.length ? h.files : (h.file ? [h.file] : []));
    if (!files.length) files = (host.getAttribute('data-hero-files') || '').split('|').filter(Boolean);
    if (!files.length) return;

    var still = h.zoom === false || host.hasAttribute('data-hero-still');
    if (h.zoom === true) still = false;
    var wanted = Number(h.zoomSpeed);
    var speed = wanted ? Math.min(90, Math.max(10, wanted)) : 0;   // 0 = leave what the build baked in

    if (host.getAttribute('data-hero-files') !== files.join('|')) {
      var box = document.createElement('div');
      box.id = 'hero-media';
      box.className = 'hero-shuffle';
      box.setAttribute('data-hero-files', files.join('|'));
      files.forEach(function (f, i) {
        var slide = document.createElement('div');
        slide.className = 'hero-slide' + (i === 0 ? ' on' : '');
        var im = document.createElement('img');
        im.className = 'hero-shot' + (i === 0 && !still ? ' kb' : '');
        im.src = heroAssetUrl(f);
        im.alt = i === 0 ? (h.alt || 'ARMERA bathroomware') : '';
        slide.appendChild(im);
        box.appendChild(slide);
      });
      if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
      host.parentNode.replaceChild(box, host);
      host = box;
    }

    if (speed) host.style.setProperty('--hero-zoom', speed + 's');
    if (still) {
      host.setAttribute('data-hero-still', '');
      [].forEach.call(host.querySelectorAll('img'), function (im) { im.classList.remove('kb'); });
    } else {
      host.removeAttribute('data-hero-still');
      var first = host.querySelector('.hero-slide.on img');
      if (first) first.classList.add('kb');
    }
    shuffleHero(host, still);
  }

  // Bring the next photograph across, and let it start its own drift as it lands.
  function shuffleHero(box, still) {
    if (heroTimer) return;
    var slides = [].slice.call(box.querySelectorAll('.hero-slide'));
    if (slides.length < 2) return;
    var at = 0;
    heroTimer = setInterval(function () {
      if (document.hidden || !box.isConnected) return;
      var cur = slides[at];
      at = (at + 1) % slides.length;
      var next = slides[at];
      // park it off to the right without animating, then bring it in
      next.classList.remove('out', 'on');
      next.style.transition = 'none';
      void next.offsetWidth;
      next.style.transition = '';
      cur.classList.remove('on');
      cur.classList.add('out');
      next.classList.add('on');
      var im = next.querySelector('img');
      if (im && !still) { im.classList.remove('kb'); void im.offsetWidth; im.classList.add('kb'); }
      park(cur);
    }, 5000);
  }

  // Once a photograph has finished sliding out, put it back on the right-hand
  // side and stop its drift, so nothing is left running off to the left.
  function park(slide) {
    var done = function () {
      slide.removeEventListener('transitionend', done);
      if (!slide.classList.contains('out')) return;
      slide.style.transition = 'none';
      slide.classList.remove('out');
      void slide.offsetWidth;
      slide.style.transition = '';
      var im = slide.querySelector('img');
      if (im) im.classList.remove('kb');
    };
    slide.addEventListener('transitionend', done);
    setTimeout(done, 1600);   // in case the transition never reports back
  }

  // Some browsers pause a hero video when the tab is hidden, or refuse the
  // first autoplay attempt.
  function nudgeVideo(v) {
    if (!v || v.tagName !== 'VIDEO') return;
    var go = function () { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } };
    v.addEventListener('canplay', go);
    v.addEventListener('loadeddata', go);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) go(); });
    go();
  }

  setupHero(null);
  nudgeVideo(document.getElementById('hero-media'));

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

    setupHero((pages.home || {}).hero);

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
