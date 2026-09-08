// ARMERA site admin — edit the catalogue, page text and instruction PDFs.
// Data lives in Supabase (site_content table + storage buckets); the public
// site reads it at runtime, so changes here are live immediately.
(function () {
  var cfg = window.ARMERA;
  var root = document.getElementById('admin-root');
  if (!root || !cfg || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

  var state = { rows: {}, keys: [], tab: 'home', menuOpen: false, catKey: null, rangeIdx: 0, editing: null, user: null };

  var el = function (tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  };
  var slugify = function (s) {
    return String(s).toLowerCase().replace(/&/g, 'and').replace(/[’'"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  };
  // A "?" that explains a field on hover / keyboard focus.
  var hq = function (tip, side) {
    return el('span', {
      class: 'hq' + (side === 'left' ? ' tip-left' : ''),
      'data-tip': tip, tabindex: '0', role: 'note', 'aria-label': 'Help: ' + tip, text: '?'
    });
  };
  // lbl('Name') or lbl('Name')
  var lbl = function (text, tip, side) {
    var l = el('label', { text: text });
    if (tip) l.appendChild(hq(tip, side));
    return l;
  };
  var msg = function (target, text, cls) {
    var old = target.querySelector('.adm-msg');
    if (old) old.remove();
    if (!text) return;
    target.appendChild(el('p', { class: 'adm-msg ' + (cls || ''), text: text }));
    toast(text, cls === 'err' ? 'err' : 'ok');
  };

  /* ---------- data ---------- */
  function loadContent() {
    return sb.from('site_content').select('key,data').order('key').then(function (res) {
      if (res.error) throw res.error;
      state.rows = {};
      state.keys = [];
      res.data.forEach(function (r) {
        state.rows[r.key] = r.data;
        if (/^\d\d-/.test(r.key)) state.keys.push(r.key);
      });
      if (!state.catKey) state.catKey = state.keys[0];
    });
  }
  function saveRow(key, target, okText) {
    return sb.from('site_content')
      .update({ data: state.rows[key], updated_at: new Date().toISOString() })
      .eq('key', key)
      .then(function (res) {
        if (res.error) msg(target, 'Could not save: ' + res.error.message, 'err');
        else msg(target, okText || 'Saved. Changes are live on the site.', 'ok');
      });
  }
  function saveRowUpsert(key, target, okText) {
    return sb.from('site_content')
      .upsert({ key: key, data: state.rows[key], updated_at: new Date().toISOString() })
      .then(function (res) {
        if (res.error) msg(target, 'Could not save: ' + res.error.message, 'err');
        else msg(target, okText || 'Saved. Changes are live on the site.', 'ok');
      });
  }
  function thisKey(range, p) {
    return state.rows[state.catKey].slug + '/' + range.slug + '/' + p.slug;
  }

  // Searchable checklist of every product, excluding one. Calls back with the list.
  function productChecklist(selected, excludeKey, onChange) {
    var box = el('div', { class: 'link-picker' });
    var chosen = {};
    (selected || []).forEach(function (k) { chosen[k] = true; });
    var products = allProducts().filter(function (p) { return p.key !== excludeKey; });

    var head = el('div', { class: 'lp-head' });
    var search = el('input', { type: 'search', placeholder: 'Search products by name, range or order code' });
    head.appendChild(search);
    var tally = el('span', { class: 'lp-tally' });
    head.appendChild(tally);
    box.appendChild(head);
    var listEl = el('div', { class: 'lp-list' });
    box.appendChild(listEl);

    var report = function () {
      var keys = Object.keys(chosen).filter(function (k) { return chosen[k]; });
      tally.textContent = keys.length + ' selected';
      onChange(keys);
    };
    var draw = function () {
      var q = (search.value || '').trim().toLowerCase();
      listEl.innerHTML = '';
      var shown = products.filter(function (p) { return !q || p.hay.indexOf(q) !== -1; });
      if (!shown.length) {
        listEl.appendChild(el('p', { class: 'small', style: 'padding:10px 2px', text: 'No products match that search.' }));
        return;
      }
      var lastGroup = '';
      shown.slice(0, 400).forEach(function (p) {
        var group = p.category + ' · ' + p.range;
        if (group !== lastGroup) { listEl.appendChild(el('p', { class: 'lp-group', text: group })); lastGroup = group; }
        var row = el('label', { class: 'lp-row' });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = !!chosen[p.key];
        cb.addEventListener('change', function () { chosen[p.key] = cb.checked; report(); });
        row.appendChild(cb);
        row.appendChild(el('span', { class: 'lp-name', text: p.name }));
        listEl.appendChild(row);
      });
    };
    search.addEventListener('input', draw);
    draw();
    report();
    return box;
  }

  /* ---------- browse files already on the site ---------- */
  // opts: { folders: [{key,label}], accept: 'image'|'video'|'any', onPick: fn(path) }
  function browseFiles(opts) {
    var folders = opts.folders || [{ key: 'lifestyle', label: 'Photography' }];
    var accept = opts.accept || 'any';
    var current = folders[0].key;
    var cache = {};

    var IMG = /\.(jpe?g|png|webp|gif|avif)$/i;
    var VID = /\.(mp4|webm|mov|m4v)$/i;
    function allowed(name) {
      if (accept === 'image') return IMG.test(name);
      if (accept === 'video') return VID.test(name);
      if (accept === 'media') return IMG.test(name) || VID.test(name);
      return true;
    }

    var overlay = el('div', { class: 'fb-overlay' });
    var modal = el('div', { class: 'fb' });
    overlay.appendChild(modal);

    var head = el('div', { class: 'fb-head' });
    head.appendChild(el('h3', { text: 'Site files' }));
    var close = el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Close' });
    head.appendChild(close);
    modal.appendChild(head);
    modal.appendChild(el('p', { class: 'hint', style: 'margin:0 0 14px',
      text: 'Everything already uploaded to the site. Choose a file to use it — nothing is uploaded again.' }));

    var tabs = el('div', { class: 'fb-tabs' });
    modal.appendChild(tabs);
    var search = el('input', { type: 'search', placeholder: 'Search by file name', class: 'fb-search' });
    modal.appendChild(search);
    var grid = el('div', { class: 'fb-grid' });
    modal.appendChild(grid);
    var note = el('p', { class: 'small', style: 'margin-top:12px' });
    modal.appendChild(note);

    function shut() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    }
    function onKey(e) { if (e.key === 'Escape') shut(); }
    close.addEventListener('click', shut);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) shut(); });
    document.addEventListener('keydown', onKey);

    function drawTabs() {
      tabs.innerHTML = '';
      folders.forEach(function (f) {
        var b = el('button', { class: 'fb-tab' + (f.key === current ? ' on' : ''), text: f.label, type: 'button' });
        b.addEventListener('click', function () { current = f.key; drawTabs(); load(); });
        tabs.appendChild(b);
      });
    }

    function draw(files) {
      var q = (search.value || '').trim().toLowerCase();
      var shown = files.filter(function (f) { return !q || f.name.toLowerCase().indexOf(q) !== -1; });
      grid.innerHTML = '';
      if (!shown.length) {
        note.textContent = files.length ? 'No files match that search.' : 'This folder is empty.';
        return;
      }
      note.textContent = shown.length + (shown.length === 1 ? ' file' : ' files');
      shown.slice(0, 300).forEach(function (f) {
        var path = current + '/' + f.name;
        var url = cfg.assets + '/' + path.split('/').map(encodeURIComponent).join('/');
        var card = el('button', { class: 'fb-item', type: 'button', title: f.name });
        var thumb = el('span', { class: 'fb-thumb' });
        if (IMG.test(f.name)) {
          thumb.appendChild(el('img', { src: url, alt: '', loading: 'lazy' }));
        } else if (VID.test(f.name)) {
          var v = el('video', { src: url, muted: 'muted', preload: 'metadata' });
          v.muted = true;
          thumb.appendChild(v);
          thumb.appendChild(el('span', { class: 'fb-vid', text: 'Video' }));
        } else {
          thumb.appendChild(el('span', { class: 'fb-doc', text: (f.name.split('.').pop() || '').toUpperCase() }));
        }
        card.appendChild(thumb);
        var kb = f.metadata && f.metadata.size ? (f.metadata.size > 1048576
          ? (f.metadata.size / 1048576).toFixed(1) + ' MB' : Math.round(f.metadata.size / 1024) + ' KB') : '';
        card.appendChild(el('span', { class: 'fb-name', text: f.name }));
        if (kb) card.appendChild(el('span', { class: 'fb-size', text: kb }));
        card.addEventListener('click', function () { opts.onPick(path, f.name); shut(); });
        grid.appendChild(card);
      });
      if (shown.length > 300) note.textContent = 'Showing the first 300 of ' + shown.length + ' — search to narrow it down.';
    }

    function load() {
      grid.innerHTML = '';
      note.textContent = 'Loading…';
      if (cache[current]) return draw(cache[current]);
      sb.storage.from('site-assets').list(current, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
        .then(function (res) {
          var files = (res.data || []).filter(function (f) { return f && f.name && allowed(f.name); });
          cache[current] = files;
          draw(files);
        });
    }
    search.addEventListener('input', function () { if (cache[current]) draw(cache[current]); });

    drawTabs();
    load();
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
  }

  /* ---------- floating confirmations ---------- */
  function toastHost() {
    var h = document.getElementById('adm-toasts');
    if (!h) {
      h = el('div', { id: 'adm-toasts', class: 'toasts' });
      document.body.appendChild(h);
    }
    return h;
  }
  // kind: 'ok' | 'err' | 'work'. Work toasts stay until you close them.
  function toast(text, kind, opts) {
    opts = opts || {};
    var t = el('div', { class: 'toast toast--' + (kind || 'ok') });
    var body = el('div', { class: 'toast-body' });
    body.appendChild(el('p', { class: 'toast-text', text: text }));
    t.appendChild(body);
    toastHost().appendChild(t);
    requestAnimationFrame(function () { t.classList.add('in'); });

    var timer = null;
    var close = function () {
      if (t.dataset.closing) return;
      t.dataset.closing = '1';
      t.classList.remove('in');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 420);
    };
    if (kind !== 'work') {
      timer = setTimeout(close, kind === 'err' ? 6000 : 3000);
      t.addEventListener('click', function () { clearTimeout(timer); close(); });
    }

    return {
      el: t,
      close: close,
      progress: function (pct) {
        var bar = t.querySelector('.toast-bar span');
        if (!bar) {
          var wrap = el('div', { class: 'toast-bar' });
          wrap.appendChild(el('span', {}));
          body.appendChild(wrap);
          bar = wrap.firstChild;
        }
        bar.style.width = Math.max(2, Math.min(100, pct)) + '%';
        var pc = t.querySelector('.toast-pct');
        if (!pc) { pc = el('span', { class: 'toast-pct' }); t.appendChild(pc); }
        pc.textContent = Math.round(pct) + '%';
      },
      finish: function (msgText, ok) {
        if (timer) clearTimeout(timer);
        t.className = 'toast toast--' + (ok === false ? 'err' : 'ok') + ' in';
        t.querySelector('.toast-text').textContent = msgText;
        var bar = t.querySelector('.toast-bar');
        if (bar) bar.remove();
        var pc = t.querySelector('.toast-pct');
        if (pc) pc.remove();
        setTimeout(close, ok === false ? 6000 : 3000);
      }
    };
  }

  /* ---------- uploads with progress ---------- */
  // The Supabase client gives no progress events, so large files (a hero video)
  // look frozen. This posts the file directly so upload progress can be shown.
  function uploadWithProgress(bucket, path, file, label, contentType) {
    var t = toast((label || 'Uploading') + '…', 'work');
    t.progress(0);
    return sb.auth.getSession().then(function (r) {
      var token = r && r.data && r.data.session && r.data.session.access_token;
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', cfg.supabaseUrl + '/storage/v1/object/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/'), true);
        xhr.setRequestHeader('apikey', cfg.anonKey);
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.setRequestHeader('x-upsert', 'true');
        xhr.setRequestHeader('cache-control', 'max-age=3600');
        if (contentType || file.type) xhr.setRequestHeader('Content-Type', contentType || file.type);
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) t.progress(e.loaded / e.total * 100);
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) { t.progress(100); resolve(t); }
          else { t.finish('Upload failed (' + xhr.status + ')', false); reject(new Error('Upload failed: ' + xhr.status)); }
        };
        xhr.onerror = function () { t.finish('Upload failed — check your connection', false); reject(new Error('Network error')); };
        xhr.send(file);
      });
    });
  }

  function uploadTo(folder, file, label) {
    var name = slugify(file.name.replace(/\.[^.]+$/, '')) + file.name.match(/\.[^.]+$/)[0].toLowerCase();
    return uploadWithProgress('site-assets', folder + '/' + name, file, label || ('Uploading ' + file.name))
      .then(function (t) {
        t.finish('Uploaded ' + file.name, true);
        return name;
      });
  }

  /* ---------- login ---------- */
  function renderLogin(note) {
    root.innerHTML = '';
    var form = el('form', { class: 'adm', style: 'max-width:420px' });
    form.appendChild(el('span', { class: 'eyebrow', text: 'ARMERA' }));
    form.appendChild(el('h1', { style: 'margin:12px 0 6px;font-size:34px', text: 'Site admin' }));
    form.appendChild(el('p', { class: 'small', text: 'Sign in to edit the catalogue, page text and instructions.' }));
    form.appendChild(el('label', { text: 'Email' }));
    var email = el('input', { type: 'email', autocomplete: 'username' });
    form.appendChild(email);
    form.appendChild(el('label', { text: 'Password' }));
    var pw = el('input', { type: 'password', autocomplete: 'current-password' });
    form.appendChild(pw);
    var btn = el('button', { class: 'abtn', type: 'submit', text: 'Sign in', style: 'margin-top:22px' });
    form.appendChild(el('div', {}, [btn]));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }).then(function (res) {
        btn.disabled = false;
        if (res.error) msg(form, res.error.message, 'err');
        else boot();
      });
    });
    root.appendChild(form);
    if (note) msg(form, note, 'ok');
  }

  /* ---------- shell ---------- */
  // The greeting assembles itself: each word lifts into focus in turn, then a
  // hairline draws itself under the name.
  function greetingNode() {
    var h1 = el('h1', { class: 'adm-greet' });
    var words = greeting().split(' ');
    words.forEach(function (w, i) {
      var slot = el('span', { class: 'gw' + (i === words.length - 1 && words.length > 1 ? ' gw--name' : '') });
      var inner = el('span', { class: 'gw-i', text: w });
      inner.style.animationDelay = (0.06 + i * 0.075).toFixed(3) + 's';
      slot.appendChild(inner);
      h1.appendChild(slot);
      if (i < words.length - 1) h1.appendChild(document.createTextNode(' '));
    });
    var rule = el('span', { class: 'gw-rule' });
    rule.style.animationDelay = (0.2 + words.length * 0.075).toFixed(3) + 's';
    h1.appendChild(rule);
    return h1;
  }

  function displayName() {
    var m = (state.user && state.user.user_metadata) || {};
    return m.display_name || m.full_name || m.name || '';
  }
  function greeting() {
    var name = displayName();
    if (!name) return 'Welcome';
    var h = new Date().getHours();
    return (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + ', ' + name;
  }

  function renderShell() {
    root.innerHTML = '';
    var wrap = el('div', { class: 'adm' });
    var here = section(state.tab);
    var head = el('div', { class: 'adm-head' });
    var hd = el('div', {});
    if (here) {
      var back = el('button', { class: 'adm-back', type: 'button', text: '‹  Quick access' });
      back.addEventListener('click', function () { openSection('home'); });
      hd.appendChild(back);
      hd.appendChild(el('h1', { style: 'margin-top:8px;font-size:34px', text: here[1] }));
    } else {
      hd.appendChild(el('span', { class: 'eyebrow', text: 'ARMERA — Site admin' }));
      hd.appendChild(greetingNode());
    }
    head.appendChild(hd);

    var bar = el('div', { class: 'adm-bar' });
    var menuWrap = el('div', { class: 'adm-menu-wrap' });
    var menuBtn = el('button', {
      class: 'abtn abtn--sm adm-menu-btn' + (state.menuOpen ? ' on' : ''), type: 'button',
      'aria-expanded': state.menuOpen ? 'true' : 'false', text: 'Menu'
    });
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.menuOpen = !state.menuOpen;
      renderShell();
    });
    menuWrap.appendChild(menuBtn);
    if (state.menuOpen) {
      var mp = menuPanel();
      mp.addEventListener('click', function (e) { e.stopPropagation(); });
      menuWrap.appendChild(mp);
    }
    bar.appendChild(menuWrap);
    bar.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Sign out', onclick: function () { sb.auth.signOut().then(function () { renderLogin(); }); } }));
    head.appendChild(bar);
    wrap.appendChild(head);

    if (!displayName()) {
      var nameBox = el('div', { class: 'adm-panel', style: 'margin-bottom:26px;border:1px solid var(--line);background:var(--paper);padding:18px 22px;max-width:520px' });
      nameBox.appendChild(el('p', { class: 'small', text: 'What should we call you? Your name is only used for this greeting.' }));
      var nameIn = el('input', { type: 'text', placeholder: 'Your name', style: 'margin-top:10px' });
      var nameBtn = el('button', { class: 'abtn abtn--sm', text: 'Save', style: 'margin-top:12px' });
      nameBtn.addEventListener('click', function () {
        var v = nameIn.value.trim();
        if (!v) return;
        sb.auth.updateUser({ data: { display_name: v } }).then(function (res) {
          if (!res.error && res.data && res.data.user) state.user = res.data.user;
          renderShell();
        });
      });
      nameBox.appendChild(nameIn);
      nameBox.appendChild(el('div', {}, [nameBtn]));
      wrap.appendChild(nameBox);
    }

    var panel = el('div', { class: 'adm-panel' });
    wrap.appendChild(panel);
    root.appendChild(wrap);

    if (state.tab === 'home') renderHome(panel);
    if (state.tab === 'dashboard') renderDashboard(panel);
    if (state.tab === 'catalogue') renderCatalogue(panel);
    if (state.tab === 'pages') renderPages(panel);
    if (state.tab === 'instructions') renderInstructions(panel);
    if (state.tab === 'videos') renderVideos(panel);
    if (state.tab === 'gallery') renderGallery(panel);
    if (state.tab === 'guarantees') renderGuarantees(panel);
    if (state.tab === 'retailers') renderRetailers(panel);
    if (state.tab === 'brochure') renderBrochure(panel);
    if (state.tab === 'account') renderAccount(panel);

    // A click anywhere off the menu closes it, and so does Escape.
    if (!state.menuBound) {
      state.menuBound = true;
      document.addEventListener('click', function (e) {
        if (!state.menuOpen) return;
        if (e.target && e.target.closest && e.target.closest('.adm-menu-wrap')) return;
        state.menuOpen = false;
        renderShell();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && state.menuOpen) { state.menuOpen = false; renderShell(); }
      });
    }
  }

  // One-time setup for visitor recording (paste into Supabase → SQL Editor).
  var SETUP_SQL = [
    'create table if not exists public.page_views (',
    '  id bigserial primary key,',
    '  ts timestamptz not null default now(),',
    '  path text not null check (length(path) between 1 and 300),',
    '  page_type text check (length(page_type) <= 30),',
    '  item_name text check (length(item_name) <= 160),',
    '  item_ref text check (length(item_ref) <= 160),',
    '  referrer_host text check (length(referrer_host) <= 120),',
    "  device text check (device in ('mobile','tablet','desktop')),",
    '  session_id text not null check (length(session_id) between 6 and 40)',
    ');',
    '',
    'create index if not exists page_views_ts_idx on public.page_views (ts desc);',
    'create index if not exists page_views_type_idx on public.page_views (page_type, ts desc);',
    'create index if not exists page_views_item_idx on public.page_views (item_name, ts desc);',
    '',
    'alter table public.page_views enable row level security;',
    '',
    '-- visitors may record a view, but can never read them back',
    'create policy "anon can record a view" on public.page_views',
    '  for insert to anon with check (true);',
    '',
    '-- only the signed-in admin can read the figures',
    'create policy "admin reads analytics" on public.page_views',
    '  for select to authenticated using (true);'
  ].join('\n');

  /* ---------- dashboard tab ---------- */
  var DASH = { days: 30, rows: null, err: null };

  function renderDashboard(panel) {
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'A live check of the site and what visitors are looking at. ' +
      'Figures are gathered by the site itself — no cookies, no personal data.' }));

    // --- status card with the animated tick ---
    var status = el('div', { class: 'dash-status checking' });
    var tick = el('div', { class: 'tick-wrap', html:
      '<svg viewBox="0 0 52 52" class="tick"><circle class="tick-ring" cx="26" cy="26" r="24"/>' +
      '<path class="tick-mark" fill="none" d="M14 27 l8 8 l16 -17"/></svg>' });
    var statusText = el('div', { class: 'dash-status-text' });
    statusText.appendChild(el('span', { class: 'eyebrow', text: 'Site health' }));
    var statusHead = el('h2', { text: 'Checking…' });
    statusText.appendChild(statusHead);
    var statusSub = el('p', { class: 'small', text: 'Testing the website, the content store and the files behind it.' });
    statusText.appendChild(statusSub);
    status.appendChild(tick);
    status.appendChild(statusText);
    panel.appendChild(status);

    var problems = el('div', { class: 'dash-problems' });
    panel.appendChild(problems);

    // --- visitor stats ---
    var statsWrap = el('div', {});
    panel.appendChild(statsWrap);

    runChecks(status, statusHead, statusSub, problems);
    renderStats(statsWrap);
  }

  /* ---------- health checks ---------- */
  function runChecks(status, head, sub, out) {
    var checks = [];
    var add = function (level, title, detail, fix) {
      checks.push({ level: level, title: title, detail: detail, fix: fix });
    };

    var probe = function (url) {
      return fetch(url, { method: 'GET', cache: 'no-store' })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    };

    var pages = state.rows.pages || {};
    var cat = pages.catalogue || {};
    var jobs = [];

    // content store
    jobs.push(sb.from('site_content').select('key').limit(1).then(function (r) {
      if (r.error) add('bad', 'Content store unreachable', r.error.message, 'The website falls back to the pages built into it. Try again shortly.');
    }));

    // storage + catalogue file
    jobs.push(probe(cfg.assets + '/brand/logo.png').then(function (ok) {
      if (!ok) add('bad', 'Image store unreachable', 'The logo could not be loaded from storage.', 'Product photos may not appear. Check the Supabase project is running.');
    }));
    if (cat.file) {
      jobs.push(probe(cfg.assets + '/documents/' + encodeURIComponent(cat.file)).then(function (ok) {
        if (!ok) add('bad', 'Catalogue PDF missing', cat.file + ' could not be found.', 'Upload the catalogue again on the Catalogue tab.');
      }));
    } else {
      add('warn', 'No catalogue set', 'Catalogue links have nothing to open.', 'Upload one on the Catalogue tab.');
    }

    // instructions
    jobs.push(sb.storage.from(cfg.instructionsBucket).list('', { limit: 500 }).then(function (r) {
      var n = ((r.data) || []).filter(function (f) { return /\.pdf$/i.test(f.name); }).length;
      if (!n) add('warn', 'No instruction documents', 'The Instructions page has nothing to show.', 'Add PDFs on the Instructions tab.');
    }));

    // videos
    var vids = state.rows.videos;
    if (!Array.isArray(vids) || !vids.length) add('warn', 'No how-to videos', 'The How-to videos page is empty.', 'Add videos on the Videos tab.');

    // retailers
    var rets = state.rows.retailers;
    if (!Array.isArray(rets) || !rets.length) {
      add('warn', 'No retailers listed', 'The Find a retailer map has no pins.', 'Add retailers on the Retailers tab.');
    } else {
      var noPos = rets.filter(function (r) { return typeof r.lat !== 'number' || typeof r.lng !== 'number'; });
      if (noPos.length) add('bad', noPos.length + ' retailer(s) missing a map position',
        noPos.slice(0, 4).map(function (r) { return r.name; }).join(', ') + (noPos.length > 4 ? '…' : ''),
        'Open each on the Retailers tab and press “Locate from postcode”.');
    }

    // catalogue data quality
    var emptyRanges = [], badPrice = [], noSku = [], noPhoto = [];
    state.keys.forEach(function (k) {
      (state.rows[k].ranges || []).forEach(function (rg) {
        if (!rg.products || !rg.products.length) emptyRanges.push(rg.title);
        (rg.products || []).forEach(function (p) {
          (p.variants || []).forEach(function (v) {
            if (!v.price) badPrice.push(p.name + ' — ' + (v.finish || v.sku));
            if (!v.sku) noSku.push(p.name);
            if (!v.image && !p.image) noPhoto.push(p.name + ' — ' + (v.finish || v.sku));
          });
        });
      });
    });
    if (emptyRanges.length) add('warn', emptyRanges.length + ' range(s) with no products',
      emptyRanges.slice(0, 4).join(', '), 'Add products, or delete the range on the Products tab.');
    if (badPrice.length) add('bad', badPrice.length + ' option(s) with no price',
      badPrice.slice(0, 4).join('; '), 'Set a price on the Products tab — options at £0 look broken to customers.');
    if (noSku.length) add('warn', noSku.length + ' option(s) with no order code', noSku.slice(0, 4).join(', '), 'Add the code on the Products tab.');
    if (noPhoto.length) add('warn', noPhoto.length + ' option(s) with no photo at all',
      noPhoto.slice(0, 4).join('; '), 'Upload photos on the Products tab.');

    Promise.all(jobs).then(function () {
      out.innerHTML = '';
      var bad = checks.filter(function (c) { return c.level === 'bad'; });
      var warn = checks.filter(function (c) { return c.level === 'warn'; });

      status.classList.remove('checking');
      if (bad.length) {
        status.classList.add('bad');
        head.textContent = 'Status: Needs attention';
        sub.textContent = bad.length + ' problem' + (bad.length === 1 ? '' : 's') + ' to look at' + (warn.length ? ', plus ' + warn.length + ' suggestion' + (warn.length === 1 ? '' : 's') : '') + '.';
      } else {
        status.classList.add('ok');
        head.textContent = 'Status: Online';
        sub.textContent = warn.length
          ? 'The website and everything behind it is working. ' + warn.length + ' suggestion' + (warn.length === 1 ? '' : 's') + ' below.'
          : 'The website and everything behind it is working normally.';
      }

      if (!checks.length) {
        out.appendChild(el('div', { class: 'dash-note ok', text: 'No problems found — nothing needs your attention.' }));
        return;
      }
      out.appendChild(el('h3', { text: 'Things to look at', style: 'margin-top:30px' }));
      bad.concat(warn).forEach(function (c) {
        var row = el('div', { class: 'dash-issue ' + c.level });
        row.appendChild(el('span', { class: 'dot' }));
        var body = el('div', {});
        body.appendChild(el('p', { class: 'ttl', text: c.title }));
        if (c.detail) body.appendChild(el('p', { class: 'det', text: c.detail }));
        if (c.fix) body.appendChild(el('p', { class: 'fix', text: c.fix }));
        row.appendChild(body);
        out.appendChild(row);
      });
    });
  }

  /* ---------- visitor statistics ---------- */
  function renderStats(wrap) {
    wrap.innerHTML = '';
    var head = el('div', { class: 'section-head', style: 'margin:44px 0 20px;align-items:center' });
    var hd = el('div', {});
    hd.appendChild(el('h3', { text: 'Visitors' }));
    head.appendChild(hd);
    var ranges = el('div', { class: 'dash-range' });
    [[7, '7 days'], [30, '30 days'], [90, '90 days']].forEach(function (r) {
      var btn = el('button', { type: 'button', class: 'abtn abtn--ghost abtn--sm' + (DASH.days === r[0] ? ' on' : ''), text: r[1] });
      btn.addEventListener('click', function () { DASH.days = r[0]; renderStats(wrap); });
      ranges.appendChild(btn);
    });
    head.appendChild(ranges);
    wrap.appendChild(head);

    var body = el('div', {});
    wrap.appendChild(body);
    body.appendChild(el('p', { class: 'small', text: 'Loading visitor figures…' }));

    var since = new Date(Date.now() - DASH.days * 864e5).toISOString();
    sb.from('page_views')
      .select('ts,page_type,item_name,item_ref,referrer_host,device,session_id')
      .gte('ts', since).order('ts', { ascending: false }).limit(20000)
      .then(function (res) {
        body.innerHTML = '';
        if (res.error) return statsUnavailable(body, res.error);
        drawStats(body, res.data || []);
      });
  }

  function statsUnavailable(body, error) {
    var missing = /page_views/i.test(error.message || '') || error.code === '42P01' || error.code === 'PGRST205';
    var card = el('div', { class: 'dash-note warn' });
    if (missing) {
      card.appendChild(el('p', { html: '<b>Visitor recording is not switched on yet.</b>' }));
      card.appendChild(el('p', { class: 'small', style: 'margin-top:8px', text:
        'The website is ready to record visits, but the table that stores them has not been created. ' +
        'Open your Supabase project → SQL Editor, paste the block below and run it once. Figures will start appearing straight away.' }));
      var sql = el('pre', { class: 'dash-sql', text: SETUP_SQL });
      card.appendChild(sql);
      var copy = el('button', { class: 'abtn abtn--sm', text: 'Copy the SQL', onclick: function () {
        navigator.clipboard.writeText(SETUP_SQL).then(function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy the SQL'; }, 2000); });
      } });
      card.appendChild(copy);
    } else {
      card.appendChild(el('p', { text: 'Visitor figures could not be loaded: ' + (error.message || 'unknown error') }));
    }
    body.appendChild(card);
  }

  function drawStats(body, rows) {
    if (!rows.length) {
      body.appendChild(el('div', { class: 'dash-note', html:
        '<b>No visits recorded in this period yet.</b>' +
        '<p class="small" style="margin-top:8px">Recording starts the moment someone opens the site. ' +
        'Your own visits to this admin area are never counted.</p>' }));
      return;
    }

    var sessions = {}, devices = {}, refs = {}, products = {}, ranges = {}, paths = {}, daily = {};
    var productViews = 0;
    for (var i = 0; i < DASH.days; i++) {
      var d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      daily[d] = 0;
    }
    rows.forEach(function (r) {
      sessions[r.session_id] = 1;
      devices[r.device || 'unknown'] = (devices[r.device || 'unknown'] || 0) + 1;
      if (r.referrer_host) refs[r.referrer_host] = (refs[r.referrer_host] || 0) + 1;
      var day = String(r.ts).slice(0, 10);
      if (day in daily) daily[day]++;
      paths[r.path] = (paths[r.path] || 0) + 1;
      if (r.page_type === 'product') {
        productViews++;
        var nm = r.item_name || r.item_ref || 'Unnamed product';
        products[nm] = (products[nm] || 0) + 1;
      }
      if (r.page_type === 'range') {
        var rn = r.item_name || r.item_ref || 'Unnamed range';
        ranges[rn] = (ranges[rn] || 0) + 1;
      }
    });

    var uniq = Object.keys(sessions).length;
    var tiles = el('div', { class: 'dash-tiles' });
    var tile = function (n, label, note) {
      var t = el('div', { class: 'dash-tile' });
      var str = String(n);
      // long text values (a domain name) need a smaller size than a count
      t.appendChild(el('span', { class: 'n' + (str.length > 7 ? ' n--text' : ''), text: str }));
      t.appendChild(el('span', { class: 'l', text: label }));
      if (note) t.appendChild(el('span', { class: 'sub', text: note }));
      return t;
    };
    var topRef = Object.keys(refs).sort(function (a, b) { return refs[b] - refs[a]; })[0];
    tiles.appendChild(tile(rows.length.toLocaleString('en-GB'), 'Page views', 'last ' + DASH.days + ' days'));
    tiles.appendChild(tile(uniq.toLocaleString('en-GB'), 'Visits', 'separate browsing sessions'));
    tiles.appendChild(tile(productViews.toLocaleString('en-GB'), 'Product views', Object.keys(products).length + ' different products'));
    tiles.appendChild(tile(topRef || '—', 'Top source', topRef ? refs[topRef] + ' views' : 'mostly direct visits'));
    body.appendChild(tiles);

    body.appendChild(dailyChart(daily));

    var grid = el('div', { class: 'dash-grid' });
    grid.appendChild(rankTable('Most viewed products', products, 'product', 10));
    grid.appendChild(rankTable('Most viewed ranges', ranges, 'range', 10));
    body.appendChild(grid);

    var grid2 = el('div', { class: 'dash-grid' });
    grid2.appendChild(rankTable('Most viewed pages', paths, 'page', 10));
    var side = el('div', {});
    side.appendChild(rankTable('Where visitors came from', refs, 'source', 6, 'No referrals yet — visitors are arriving directly.'));
    side.appendChild(rankTable('Devices', devices, 'device', 4));
    grid2.appendChild(side);
    body.appendChild(grid2);

    body.appendChild(el('p', { class: 'small', style: 'margin-top:26px', text:
      'Counted on this site only, without cookies or personal data. A “visit” is one browsing session. ' +
      'Visits to this admin area are not recorded.' + (rows.length >= 20000 ? ' Showing the most recent 20,000 views.' : '') }));
  }

  function rankTable(title, obj, kind, limit, emptyText) {
    var box = el('div', { class: 'dash-card' });
    box.appendChild(el('h4', { text: title }));
    var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; }).slice(0, limit);
    if (!keys.length) {
      box.appendChild(el('p', { class: 'small', text: emptyText || 'Nothing recorded yet.' }));
      return box;
    }
    var max = obj[keys[0]] || 1;
    var list = el('div', { class: 'rank' });
    keys.forEach(function (k) {
      var row = el('div', { class: 'rank-row' });
      row.appendChild(el('span', { class: 'rk-name', title: k, text: k }));
      var barWrap = el('span', { class: 'rk-bar' });
      barWrap.appendChild(el('span', { class: 'rk-fill', style: 'width:' + Math.max(3, Math.round(obj[k] / max * 100)) + '%' }));
      row.appendChild(barWrap);
      row.appendChild(el('span', { class: 'rk-n', text: String(obj[k]) }));
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
  }

  // Single-series daily views. One muted brand hue, recessive axes,
  // per-bar hover readout, 2px gaps, rounded data-ends.
  function dailyChart(daily) {
    var days = Object.keys(daily).sort();
    var vals = days.map(function (d) { return daily[d]; });
    var max = Math.max.apply(null, vals.concat([1]));
    var W = 980, H = 190, padL = 34, padB = 26, padT = 12;
    var innerW = W - padL - 8, innerH = H - padB - padT;
    var slot = innerW / days.length;
    var barW = Math.max(3, slot - 2);            // 2px surface gap between bars

    var box = el('div', { class: 'dash-card', style: 'margin-top:22px' });
    var hd = el('div', { class: 'chart-head' });
    hd.appendChild(el('h4', { text: 'Page views per day' }));
    var readout = el('span', { class: 'chart-readout', text: '' });
    hd.appendChild(readout);
    box.appendChild(hd);

    var ticks = [0, Math.round(max / 2), max].filter(function (t, i, a) { return a.indexOf(t) === i; });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Page views per day over the last ' + days.length + ' days">';
    ticks.forEach(function (t) {
      var y = padT + innerH - (t / max) * innerH;
      svg += '<line x1="' + padL + '" x2="' + (W - 8) + '" y1="' + y + '" y2="' + y + '" class="grid"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" class="ax" text-anchor="end">' + t + '</text>';
    });
    days.forEach(function (d, i) {
      var v = daily[d];
      var h = v ? Math.max(2, (v / max) * innerH) : 0;
      var x = padL + i * slot;
      var y = padT + innerH - h;
      if (h) svg += '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" rx="2" class="bar" data-d="' + d + '" data-v="' + v + '"/>';
      svg += '<rect x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + innerH + '" class="hit" data-d="' + d + '" data-v="' + v + '"/>';
    });
    var first = days[0], last = days[days.length - 1];
    svg += '<text x="' + padL + '" y="' + (H - 6) + '" class="ax">' + niceDate(first) + '</text>';
    svg += '<text x="' + (W - 8) + '" y="' + (H - 6) + '" class="ax" text-anchor="end">' + niceDate(last) + '</text>';
    svg += '</svg>';
    var holder = el('div', { html: svg });
    box.appendChild(holder);

    Array.prototype.forEach.call(holder.querySelectorAll('.hit'), function (r) {
      r.addEventListener('mouseenter', function () {
        readout.textContent = niceDate(r.getAttribute('data-d')) + ' — ' + r.getAttribute('data-v') + ' view' + (r.getAttribute('data-v') === '1' ? '' : 's');
        var bar = holder.querySelector('.bar[data-d="' + r.getAttribute('data-d') + '"]');
        if (bar) bar.classList.add('on');
      });
      r.addEventListener('mouseleave', function () {
        readout.textContent = '';
        Array.prototype.forEach.call(holder.querySelectorAll('.bar.on'), function (b) { b.classList.remove('on'); });
      });
    });
    return box;
  }

  function niceDate(d) {
    var p = String(d).split('-');
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p[1] - 1];
    return +p[2] + ' ' + m;
  }

  /* ---------- catalogue tab ---------- */
  function renderCatalogue(panel) {
    var cat = state.rows[state.catKey];
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'Pick a <b>category</b> then a <b>range</b> below, and edit the products inside it. ' +
      'Everything you save here appears on the website straight away — no need to tell anyone to rebuild it. ' +
      'Hover a <span class="hq" data-tip="Like this one — every ? explains the box it sits next to.">?</span> for help with any box.' }));
    if (state.rangeIdx >= cat.ranges.length) state.rangeIdx = 0;

    var row = el('div', { class: 'adm-row' });
    var catSel = el('select', {
      onchange: function () { state.catKey = catSel.value; state.rangeIdx = 0; state.editing = null; renderShell(); }
    });
    state.keys.forEach(function (k) {
      var o = el('option', { value: k, text: state.rows[k].name });
      if (k === state.catKey) o.selected = true;
      catSel.appendChild(o);
    });
    var rangeSel = el('select', {
      onchange: function () { state.rangeIdx = +rangeSel.value; state.editing = null; renderShell(); }
    });
    cat.ranges.forEach(function (r, i) {
      var o = el('option', { value: i, text: r.title });
      if (i === state.rangeIdx) o.selected = true;
      rangeSel.appendChild(o);
    });
    row.appendChild(catSel);
    row.appendChild(rangeSel);
    row.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', title: 'Create a new family of products inside the chosen category.', text: 'Add range',
      onclick: function () {
        var name = prompt('Name of the new range (e.g. "Marlow")');
        if (!name) return;
        cat.ranges.push({
          slug: slugify(name), name: name, title: name, tagline: '',
          hero: { img: 'p016_01.png', caption: '' }, products: []
        });
        state.rangeIdx = cat.ranges.length - 1;
        saveRow(state.catKey, panel).then(function () { renderShell(); });
      }
    }));
    row.appendChild(el('button', {
      class: 'abtn abtn--danger abtn--sm', title: 'Permanently remove this range and every product in it. This cannot be undone.', text: 'Delete range',
      onclick: function () {
        var r = cat.ranges[state.rangeIdx];
        if (!confirm('Delete the whole "' + r.title + '" range and its ' + r.products.length + ' product(s)? This cannot be undone.')) return;
        cat.ranges.splice(state.rangeIdx, 1);
        state.rangeIdx = 0;
        saveRow(state.catKey, panel).then(function () { renderShell(); });
      }
    }));
    panel.appendChild(row);

    var range = cat.ranges[state.rangeIdx];
    if (!range) { panel.appendChild(el('p', { class: 'small', style: 'margin-top:20px', text: 'This category has no ranges yet — add one above.' })); return; }

    /* range details */
    var d = el('details', {});
    d.appendChild(el('summary', { text: 'Range details (name, tagline, hero image, colours)' }));
    var name = el('input', { type: 'text', value: range.name });
    var title = el('input', { type: 'text', value: range.title });
    var tagline = el('textarea', { text: range.tagline || '' });
    tagline.style.minHeight = '60px';
    var footnote = el('textarea', { text: range.footnote || '' });
    footnote.style.minHeight = '60px';
    var heroCap = el('textarea', { text: (range.hero && range.hero.caption) || '' });
    heroCap.style.minHeight = '60px';
    var heroFile = el('input', { type: 'file', accept: 'image/*' });
    d.appendChild(lbl('Range name')); d.appendChild(name);
    d.appendChild(lbl('Page title', 'The heading at the top of the range page — usually the range name plus the type, e.g. “Atoll furniture”.')); d.appendChild(title);
    d.appendChild(lbl('Tagline')); d.appendChild(tagline);
    d.appendChild(lbl('Footnote (optional)')); d.appendChild(footnote);
    d.appendChild(lbl('Hero image', 'The wide lifestyle photo across the top of the range page. Landscape photos work best. Current file: ' + ((range.hero && range.hero.img) || 'none') + '. Choosing a file replaces it.'));
    d.appendChild(heroFile);
    d.appendChild(lbl('Hero caption')); d.appendChild(heroCap);

    /* swatches */
    d.appendChild(lbl('Colours', 'The round colour swatches on the range page. Code is a short label such as 11 or 23 — use the same code on a product option to link them. Name is what customers read. The image is a small square of the colour.'));
    var swWrap = el('div', {});
    var swatches = range.swatches ? range.swatches.slice() : [];
    var drawSw = function () {
      swWrap.innerHTML = '';
      swatches.forEach(function (s, i) {
        var r = el('div', { class: 'srow' });
        var code = el('input', { type: 'text', value: s.code || '' });
        var nm = el('input', { type: 'text', value: s.name || '' });
        var f = el('input', { type: 'file', accept: 'image/*' });
        code.addEventListener('input', function () { s.code = code.value.trim(); });
        nm.addEventListener('input', function () { s.name = nm.value; });
        f.addEventListener('change', function () {
          if (!f.files[0]) return;
          uploadTo('swatches', f.files[0]).then(function (fname) { s.img = fname; msg(d, 'Swatch image uploaded.', 'ok'); })
            .catch(function (e) { msg(d, 'Upload failed: ' + e.message, 'err'); });
        });
        r.appendChild(code); r.appendChild(nm); r.appendChild(f);
        r.appendChild(el('button', { class: 'abtn abtn--danger abtn--sm', text: '×', type: 'button', onclick: function () { swatches.splice(i, 1); drawSw(); } }));
        swWrap.appendChild(r);
      });
    };
    drawSw();
    d.appendChild(swWrap);
    d.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Add colour', type: 'button', onclick: function () { swatches.push({ code: '', name: '', img: null }); drawSw(); } }));

    var saveRange = el('button', {
      class: 'abtn', text: 'Save range details', type: 'button', style: 'margin-top:20px;display:block',
      onclick: function () {
        range.name = name.value.trim();
        range.title = title.value.trim();
        range.tagline = tagline.value.trim();
        if (footnote.value.trim()) range.footnote = footnote.value.trim(); else delete range.footnote;
        range.hero = range.hero || {};
        range.hero.caption = heroCap.value.trim();
        var fin = function () { saveRow(state.catKey, d); };
        if (heroFile.files[0]) {
          uploadTo('lifestyle', heroFile.files[0]).then(function (fname) { range.hero.img = fname; fin(); })
            .catch(function (e) { msg(d, 'Hero upload failed: ' + e.message, 'err'); });
        } else {
          range.swatches = swatches.filter(function (s) { return s.name; });
          if (!range.swatches.length) delete range.swatches;
          fin();
        }
        range.swatches = swatches.filter(function (s) { return s.name; });
        if (!range.swatches.length) delete range.swatches;
      }
    });
    d.appendChild(saveRange);
    panel.appendChild(d);

    /* products */
    var ph = lbl('Products in ' + range.title);
    panel.appendChild(ph);
    ph.appendChild(el('a', {
      class: 'preview-link', style: 'margin-left:14px', target: '_blank', rel: 'noopener',
      href: (cfg.base || '') + '/products/' + cat.slug + '/' + range.slug + '/', text: 'View this range on the site'
    }));
    var list = el('div', { class: 'adm-list' });
    range.products.forEach(function (p, i) {
      var item = el('div', { class: 'item' });
      item.appendChild(el('span', { class: 'nm', html: p.name + (p.dims ? ' <span class="dim">' + p.dims + '</span>' : '') }));
      item.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Edit', onclick: function () { state.editing = i; renderShell(); } }));
      item.appendChild(el('button', {
        class: 'abtn abtn--danger abtn--sm', text: 'Remove',
        onclick: function () {
          if (!confirm('Remove "' + p.name + '" from the site?')) return;
          range.products.splice(i, 1);
          state.editing = null;
          saveRow(state.catKey, panel).then(function () { renderShell(); });
        }
      }));
      list.appendChild(item);
    });
    panel.appendChild(list);
    panel.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', text: 'Add product', style: 'margin-top:14px',
      title: 'Add a new product to this range. You will be asked for its name, then you can set its options, prices and photos.',
      onclick: function () {
        var nm = prompt('Product name (e.g. "700mm 2 drawer wall hung unit")');
        if (!nm) return;
        range.products.push({ slug: slugify(nm), name: nm, variants: [{ sku: '', finish: '', price: 0 }] });
        state.editing = range.products.length - 1;
        renderShell();
      }
    }));

    if (state.editing !== null && range.products[state.editing]) {
      panel.appendChild(el('hr', { class: 'rule' }));
      renderProductEditor(panel, range, range.products[state.editing]);
    }
  }

  function renderProductEditor(panel, range, p) {
    var box = el('div', {});
    box.appendChild(el('h3', { text: 'Edit — ' + p.name }));
    var addr = el('p', { class: 'hint' });
    addr.appendChild(el('span', { text: 'Page address: /products/…/' + range.slug + '/' + p.slug + '/  ' }));
    addr.appendChild(el('a', {
      class: 'preview-link', target: '_blank', rel: 'noopener',
      href: (cfg.base || '') + '/products/' + state.rows[state.catKey].slug + '/' + range.slug + '/' + p.slug + '/', text: 'View on the site'
    }));
    box.appendChild(addr);

    var name = el('input', { type: 'text', value: p.name });
    var dims = el('input', { type: 'text', value: p.dims || '' });
    var note = el('textarea', { text: p.note || '' }); note.style.minHeight = '60px';
    var footnote = el('textarea', { text: p.footnote || '' }); footnote.style.minHeight = '60px';
    box.appendChild(lbl('Name')); box.appendChild(name);
    box.appendChild(lbl('Dimensions', 'Shown under the product name. Use the catalogue format, e.g. 600w x 520h x 460d. “mm” is added automatically. Leave blank if not applicable.')); box.appendChild(dims);
    box.appendChild(lbl('Note (optional)')); box.appendChild(note);
    box.appendChild(lbl('Footnote (optional)')); box.appendChild(footnote);

    /* variants (drawn first — the photo slots below follow the option rows) */
    box.appendChild(lbl('Options & pricing', 'One row per version of this product. Code is the order code (AT.620.600.11). Finish/option is what customers read (Chrome, Matt white). Colour code links to a colour swatch — leave blank for brassware finishes. RRP is the price in pounds, numbers only.'));
    var vWrap = el('div', {});
    var imgWrap = el('div', {});
    var variants = p.variants.map(function (v) { return Object.assign({}, v); });
    var singleImage = p.image || null;

    var drawImages = function () {}; // redefined below; re-run when the option rows change
    var drawV = function () {
      vWrap.innerHTML = '';
      variants.forEach(function (v, i) {
        var r = el('div', { class: 'vrow' });
        var sku = el('input', { type: 'text', value: v.sku || '', placeholder: 'AT.620.600.11' });
        var fin = el('input', { type: 'text', value: v.finish || '', placeholder: 'Graphite grey' });
        var code = el('input', { type: 'text', value: v.code || '', placeholder: 'colour' });
        var price = el('input', { type: 'number', value: v.price || 0, min: '0', step: '1' });
        sku.addEventListener('input', function () { v.sku = sku.value.trim(); });
        sku.addEventListener('change', function () { drawImages(); });
        fin.addEventListener('input', function () { v.finish = fin.value; });
        fin.addEventListener('change', function () { drawImages(); });
        code.addEventListener('input', function () { v.code = code.value.trim(); });
        price.addEventListener('input', function () { v.price = +price.value; });
        r.appendChild(sku); r.appendChild(fin); r.appendChild(code); r.appendChild(price);
        r.appendChild(el('button', { class: 'abtn abtn--danger abtn--sm', type: 'button', text: '×', onclick: function () { variants.splice(i, 1); drawV(); drawImages(); } }));
        vWrap.appendChild(r);
      });
    };

    var thumbFor = function (fname) {
      var t = el('div', { class: 'thumb' });
      if (fname) t.appendChild(el('img', { src: cfg.assets + '/products/' + encodeURIComponent(fname), alt: '' }));
      else t.appendChild(el('span', { text: '—' }));
      return t;
    };

    // One photo slot per option, so every variation can have its own preview.
    drawImages = function () {
      imgWrap.innerHTML = '';
      if (!variants.length) {
        imgWrap.appendChild(el('p', { class: 'hint', text: 'Add an option above to give it a photo.' }));
        return;
      }
      variants.forEach(function (v, i) {
        var row = el('div', { class: 'imgrow' });
        row.appendChild(thumbFor(v.image || singleImage));
        var label = (v.finish || v.sku || 'Option ' + (i + 1));
        row.appendChild(el('span', { class: 'small', text: label + (v.image ? '' : ' — using the shared product photo') }));
        var f = el('input', { type: 'file', accept: 'image/*' });
        f.addEventListener('change', function () {
          if (!f.files[0]) return;
          uploadTo('products', f.files[0]).then(function (fname) {
            v.image = fname;
            drawImages();
            msg(box, label + ' photo uploaded — remember to Save product.', 'ok');
          }).catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
        });
        row.appendChild(f);
        imgWrap.appendChild(row);
      });
    };
    drawV();
    box.appendChild(vWrap);
    box.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Add option',
      onclick: function () { variants.push({ sku: '', finish: '', price: 0 }); drawV(); drawImages(); }
    }));
    box.appendChild(el('p', { class: 'hint', text: 'Each option gets its own photo slot below, so every variation can show its own preview. The colour code links a furniture option to its colour swatch under Range details → Colours.' }));

    box.appendChild(lbl('Photos — one per option', 'Each option can have its own photo. Customers click a row in the pricing table (or a colour swatch) and the main picture changes to that one. Options without their own photo fall back to the shared product photo.'));
    box.appendChild(imgWrap);
    drawImages();

    /* ---- dimensional drawing ---- */
    box.appendChild(el('hr', { class: 'rule' }));
    box.appendChild(lbl('Dimensional drawing', 'The measured drawing PDF for this product. It is offered on the product page and becomes page two of the specification sheet.'));
    var dwgNow = el('p', { class: 'small' });
    var setDwgLabel = function () {
      dwgNow.innerHTML = '';
      if (p.drawing) {
        dwgNow.appendChild(el('span', { text: 'Current: ' + p.drawing + '  ' }));
        dwgNow.appendChild(el('a', { class: 'preview-link', target: '_blank', rel: 'noopener',
          href: cfg.assets + '/drawings/' + encodeURIComponent(p.drawing), text: 'View' }));
      } else {
        dwgNow.appendChild(el('span', { text: 'No drawing yet — the specification sheet will be one page until you add one.' }));
      }
    };
    setDwgLabel();
    box.appendChild(dwgNow);
    var dwgFile = el('input', { type: 'file', accept: 'application/pdf' });
    box.appendChild(dwgFile);
    dwgFile.addEventListener('change', function () {
      if (!dwgFile.files[0]) return;
      uploadTo('drawings', dwgFile.files[0], 'Uploading the drawing').then(function (name) {
        p.drawing = name;
        setDwgLabel();
        msg(box, 'Drawing uploaded — press Save product to keep it.', 'ok');
      }).catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
    });

    /* ---- looks good with ---- */
    box.appendChild(el('hr', { class: 'rule' }));
    box.appendChild(lbl('Looks good with…', 'Tick other products to show underneath this one as suggested pairings. Leave all unticked to hide the section.'));
    var goesWith = (p.goesWith || []).slice();
    var pairSlot = el('div', {});
    var pairSummary = el('p', { class: 'small' });
    var drawPairSummary = function () {
      pairSummary.textContent = goesWith.length
        ? goesWith.length + ' product' + (goesWith.length === 1 ? '' : 's') + ' selected'
        : 'Nothing selected yet.';
    };
    drawPairSummary();
    box.appendChild(pairSummary);
    box.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Choose products',
      onclick: function () {
        if (pairSlot.firstChild) { pairSlot.innerHTML = ''; return; }
        pairSlot.appendChild(productChecklist(goesWith, thisKey(range, p), function (list) {
          goesWith = list; drawPairSummary();
        }));
      }
    }));
    box.appendChild(pairSlot);

    var save = el('button', {
      class: 'abtn', text: 'Save product', type: 'button', style: 'margin-top:22px;display:block',
      title: 'Save every change on this product — details, options, prices and photos — and put them live.',
      onclick: function () {
        p.name = name.value.trim();
        if (dims.value.trim()) p.dims = dims.value.trim(); else delete p.dims;
        if (note.value.trim()) p.note = note.value.trim(); else delete p.note;
        if (footnote.value.trim()) p.footnote = footnote.value.trim(); else delete p.footnote;
        p.variants = variants.filter(function (v) { return v.sku || v.finish; }).map(function (v) {
          var o = { sku: v.sku, finish: v.finish, price: Math.round(+v.price || 0) };
          if (v.code) o.code = v.code;
          return o;
        });
        if (!p.variants.length) { msg(box, 'A product needs at least one priced option.', 'err'); return; }
        // persist photos: each option keeps its own, with a shared fallback
        var okText;
        p.variants.forEach(function (nv, i) {
          if (variants[i] && variants[i].image) nv.image = variants[i].image;
        });
        if (singleImage) p.image = singleImage;
        var missing = p.variants.filter(function (v) { return !v.image; });
        if (missing.length && !p.image) {
          okText = 'Saved. Note: ' + missing.length + ' option(s) still need a photo.';
        }
        saveRow(state.catKey, box, okText);
      }
    });
    box.appendChild(save);
    panel.appendChild(box);
  }

  /* ---------- pages tab ---------- */
  function renderPages(panel) {
    var pages = state.rows.pages || {};
    pages.home = pages.home || {}; pages.about = pages.about || {}; pages.support = pages.support || {}; pages.contact = pages.contact || {};

    panel.appendChild(el('p', { class: 'tab-intro', text:
      'The wording on the main pages. Product names and prices are not here — those live under Products.' }));
    /* ---- news banner ---- */
    pages.banner = pages.banner || {};
    var b = pages.banner;
    panel.appendChild(el('h3', { text: 'News banner' }));
    panel.appendChild(el('p', { class: 'hint', text: 'A strip across the very top of the homepage — useful for an exhibition, a lead time or a seasonal notice.' }));

    var onRow = el('label', { class: 'switch-row' });
    var onBox = el('input', { type: 'checkbox' });
    onBox.checked = !!b.on;
    onRow.appendChild(onBox);
    onRow.appendChild(el('span', { text: 'Show the banner on the homepage' }));
    onRow.appendChild(hq('Untick to hide it without losing the wording — it stays here ready for next time.'));
    panel.appendChild(onRow);

    var bText = el('textarea', { text: b.text || '' });
    bText.style.minHeight = '60px';
    panel.appendChild(lbl('Banner wording'));
    panel.appendChild(bText);

    var colRow = el('div', { class: 'adm-row', style: 'margin-top:18px' });
    var bBg = el('input', { type: 'color', value: b.bg || '#232220' });
    var bFg = el('input', { type: 'color', value: b.fg || '#f4f1e9' });
    var mk = function (labelText, input, tip) {
      var w = el('label', { class: 'colour-pick' });
      w.appendChild(el('span', { text: labelText }));
      w.appendChild(input);
      if (tip) w.appendChild(hq(tip));
      return w;
    };
    colRow.appendChild(mk('Background', bBg));
    colRow.appendChild(mk('Text', bFg));
    var bSize = el('input', { type: 'number', min: '11', max: '28', value: b.size || 14, style: 'max-width:90px' });
    colRow.appendChild(mk('Size (px)', bSize));
    panel.appendChild(colRow);

    var contrastNote = el('p', { class: 'small', style: 'margin-top:10px' });
    var checkContrast = function () {
      var toRgb = function (h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; }); };
      var L = function (h) {
        return toRgb(h).map(function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
          .reduce(function (a, c, i) { return a + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
      };
      var l1 = L(bBg.value), l2 = L(bFg.value);
      var r = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      contrastNote.textContent = r >= 4.5
        ? 'Easy to read (contrast ' + r.toFixed(1) + ':1).'
        : 'Hard to read — the text and background are too close in tone (contrast ' + r.toFixed(1) + ':1). Aim for 4.5:1 or more.';
      contrastNote.style.color = r >= 4.5 ? '#4c6440' : '#8a3d2e';
    };
    bBg.addEventListener('input', checkContrast);
    bFg.addEventListener('input', checkContrast);
    checkContrast();
    panel.appendChild(contrastNote);

    var fontSel = el('select', {});
    [['site', 'The site font'], ['custom', 'An uploaded font']].forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if ((b.font || 'site') === o[0]) opt.selected = true;
      fontSel.appendChild(opt);
    });
    panel.appendChild(lbl('Banner font', 'Use the site font, or upload your own to give the banner its own character.'));
    panel.appendChild(fontSel);
    var fontBox = el('div', { style: 'margin-top:12px' });
    var fontFile = el('input', { type: 'file', accept: '.woff2,.woff,.ttf,.otf,font/*' });
    fontBox.appendChild(el('p', { class: 'small', text: b.fontFile ? 'Current font file: ' + b.fontFile : 'No font uploaded yet.' }));
    fontBox.appendChild(fontFile);
    fontBox.appendChild(el('p', { class: 'hint', text: 'A .woff2 file is best (smallest and fastest); .woff, .ttf and .otf also work. Make sure you are licensed to use the font on a website.' }));
    fontBox.style.display = fontSel.value === 'custom' ? '' : 'none';
    fontSel.addEventListener('change', function () { fontBox.style.display = fontSel.value === 'custom' ? '' : 'none'; });
    panel.appendChild(fontBox);

    panel.appendChild(el('button', {
      class: 'abtn', text: 'Save banner', style: 'margin-top:20px;display:block',
      onclick: function () {
        var finish = function () {
          b.on = onBox.checked;
          b.text = bText.value.trim();
          b.bg = bBg.value;
          b.fg = bFg.value;
          b.size = Math.max(11, Math.min(28, parseInt(bSize.value, 10) || 14));
          b.font = fontSel.value;
          pages.banner = b;
          state.rows.pages = pages;
          saveRow('pages', panel, b.on && b.text ? 'Saved — the banner is live on the homepage.' : 'Saved — the banner is hidden.');
        };
        if (fontSel.value === 'custom' && fontFile.files[0]) {
          uploadTo('fonts', fontFile.files[0]).then(function (name) { b.fontFile = name; finish(); })
            .catch(function (e) { msg(panel, 'Font upload failed: ' + e.message, 'err'); });
        } else finish();
      }
    }));

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Homepage' }));

    /* ---- hero photograph or video ---- */
    pages.home.hero = pages.home.hero || {};
    var hero = pages.home.hero;
    panel.appendChild(lbl('Top of the homepage', 'The full-width picture behind the headline. Add several photographs and they slide across, one every five seconds. A video plays automatically, silently, on a loop.'));

    var heroType = el('select', {});
    [['image', 'Photographs'], ['video', 'Video']].forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if ((hero.type || 'image') === o[0]) opt.selected = true;
      heroType.appendChild(opt);
    });

    // The photographs currently in the rotation, in the order they appear.
    var shots = (hero.files && hero.files.length ? hero.files.slice() : (hero.file ? [hero.file] : []));
    if (hero.type === 'video') shots = (hero.files || []).slice();
    var shotBox = el('div', { class: 'hero-shots' });
    var assetUrl = function (f) {
      var p = f.indexOf('/') === -1 ? 'lifestyle/' + f : f;
      return cfg.assets + '/' + p.split('/').map(encodeURIComponent).join('/');
    };
    function paintShots() {
      shotBox.innerHTML = '';
      if (heroType.value === 'video') {
        shotBox.appendChild(el('p', { class: 'hint', text: hero.file && hero.type === 'video'
          ? 'Currently playing: ' + hero.file : 'Choose a video file below.' }));
        return;
      }
      if (!shots.length) {
        shotBox.appendChild(el('p', { class: 'hint', text: 'Currently the original photograph. Add one or more below.' }));
        return;
      }
      shots.forEach(function (f, i) {
        var card = el('div', { class: 'hero-shot-card' });
        card.appendChild(el('img', { src: assetUrl(f), alt: '' }));
        card.appendChild(el('span', { class: 'hero-shot-name', text: f.split('/').pop() }));
        var tools = el('div', { class: 'hero-shot-tools' });
        if (i > 0) tools.appendChild(el('button', { class: 'iconbtn', type: 'button', title: 'Move earlier', text: '←',
          onclick: function () { shots.splice(i - 1, 0, shots.splice(i, 1)[0]); paintShots(); } }));
        if (i < shots.length - 1) tools.appendChild(el('button', { class: 'iconbtn', type: 'button', title: 'Move later', text: '→',
          onclick: function () { shots.splice(i + 1, 0, shots.splice(i, 1)[0]); paintShots(); } }));
        tools.appendChild(el('button', { class: 'iconbtn iconbtn--x', type: 'button', title: 'Remove', text: '×',
          onclick: function () { shots.splice(i, 1); paintShots(); } }));
        card.appendChild(tools);
        if (i === 0) card.appendChild(el('span', { class: 'hero-shot-first', text: 'Shown first' }));
        shotBox.appendChild(card);
      });
    }
    heroType.addEventListener('change', function () { paintShots(); zoomWrap.hidden = heroType.value === 'video'; });
    panel.appendChild(heroType);
    panel.appendChild(shotBox);

    var heroRow = el('div', { class: 'adm-row', style: 'margin-top:14px' });
    var heroFile = el('input', { type: 'file', accept: 'image/*,video/mp4,video/webm', multiple: 'multiple' });
    heroRow.appendChild(heroFile);
    heroRow.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Browse site files',
      onclick: function () {
        browseFiles({
          accept: 'media',
          folders: [
            { key: 'lifestyle', label: 'Photography & video' },
            { key: 'inspiration', label: 'Inspiration' },
            { key: 'products', label: 'Product photos' }
          ],
          onPick: function (path, name) {
            if (/\.(mp4|webm|mov|m4v)$/i.test(name)) {
              heroType.value = 'video';
              hero.file = path; hero.type = 'video';
              paintShots();
              toast('Chose ' + name + ' — press Save to use it', 'ok');
              return;
            }
            heroType.value = 'image';
            if (shots.indexOf(path) === -1) shots.push(path);
            paintShots();
            zoomWrap.hidden = false;
            toast('Added ' + name, 'ok');
          }
        });
      }
    }));
    panel.appendChild(heroRow);
    panel.appendChild(el('p', { class: 'hint', text: 'Landscape works best, and you can choose several photographs at once. For video, an MP4 of ten to twenty seconds under about 10 MB keeps the page quick to load — it plays without sound.' }));

    var zoomWrap = el('div', {});
    var zoomRow = el('label', { class: 'switch-row' });
    var zoomBox = el('input', { type: 'checkbox' });
    zoomBox.checked = hero.zoom !== false;
    zoomRow.appendChild(zoomBox);
    zoomRow.appendChild(el('span', { text: 'Slowly zoom in on the photographs' }));
    zoomWrap.appendChild(zoomRow);

    var speedRow = el('div', { class: 'slider-row' });
    var speed = el('input', { type: 'range', min: '12', max: '60', step: '1', value: String(hero.zoomSpeed || 30) });
    var speedNote = el('span', { class: 'slider-note' });
    var saySpeed = function () {
      var v = Number(speed.value);
      speedNote.textContent = v + ' seconds — ' + (v <= 18 ? 'quick' : v <= 26 ? 'brisk' : v <= 40 ? 'gentle' : 'barely there');
    };
    speed.addEventListener('input', saySpeed);
    saySpeed();
    speedRow.appendChild(el('span', { class: 'slider-label', text: 'Zoom speed' }));
    speedRow.appendChild(speed);
    speedRow.appendChild(speedNote);
    speedRow.appendChild(hq('How long one photograph takes to drift all the way in. Lower is faster.'));
    zoomWrap.appendChild(speedRow);
    zoomWrap.hidden = (hero.type || 'image') === 'video';
    panel.appendChild(zoomWrap);
    paintShots();

    panel.appendChild(el('button', {
      class: 'abtn abtn--sm', text: 'Save top of homepage', style: 'margin-top:16px;display:block',
      onclick: function () {
        hero.zoom = zoomBox.checked;
        hero.zoomSpeed = Number(speed.value);
        var isVideo = heroType.value === 'video';
        var chosen = [].slice.call(heroFile.files || []);

        var uploads = chosen.length
          ? Promise.all(chosen.map(function (f) { return uploadTo('lifestyle', f); }))
          : Promise.resolve([]);

        uploads.then(function (names) {
          if (isVideo) {
            hero.type = 'video';
            if (names.length) hero.file = names[0];
            if (!hero.file) throw new Error('Choose a video file first.');
          } else {
            names.forEach(function (n) { if (shots.indexOf(n) === -1) shots.push(n); });
            if (!shots.length) throw new Error('Add at least one photograph.');
            hero.type = 'image';
            hero.files = shots.slice();
            hero.file = shots[0];
          }
          state.rows.pages = pages;
          return saveRow('pages', panel, isVideo
            ? 'Saved — the homepage now plays ' + hero.file + '.'
            : 'Saved — ' + shots.length + (shots.length === 1 ? ' photograph' : ' photographs sliding') + ' at the top of the homepage.');
        }).then(function () { renderShell(); })
          .catch(function (e) { msg(panel, e.message || String(e), 'err'); });
      }
    }));

    panel.appendChild(el('hr', { class: 'rule' }));

    var hHeading = el('input', { type: 'text', value: pages.home.heading || '' });
    var hLede = el('textarea', { text: pages.home.lede || '' });
    panel.appendChild(lbl('Main heading')); panel.appendChild(hHeading);
    panel.appendChild(lbl('Intro sentence')); panel.appendChild(hLede);

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'About page' }));
    var aHeading = el('input', { type: 'text', value: pages.about.heading || '' });
    panel.appendChild(lbl('Heading')); panel.appendChild(aHeading);
    var sections = (pages.about.sections || []).map(function (s) { return { side: s.side, paras: (s.paras || []).slice() }; });
    var sWrap = el('div', {});
    var drawS = function () {
      sWrap.innerHTML = '';
      sections.forEach(function (s, i) {
        var side = el('input', { type: 'text', value: s.side || '', placeholder: 'Section label' });
        var ta = el('textarea', { text: (s.paras || []).join('\n\n') });
        ta.style.minHeight = '130px';
        side.addEventListener('input', function () { s.side = side.value; });
        ta.addEventListener('input', function () { s.paras = ta.value.split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(Boolean); });
        sWrap.appendChild(lbl('Section ' + (i + 1)));
        sWrap.appendChild(side);
        sWrap.appendChild(ta);
        sWrap.appendChild(el('button', { class: 'abtn abtn--danger abtn--sm', type: 'button', text: 'Remove section', style: 'margin-top:8px', onclick: function () { sections.splice(i, 1); drawS(); } }));
      });
    };
    drawS();
    panel.appendChild(sWrap);
    panel.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Add section', style: 'margin-top:12px', onclick: function () { sections.push({ side: '', paras: [] }); drawS(); } }));
    panel.appendChild(el('p', { class: 'hint', text: 'Separate paragraphs with a blank line.' }));

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Support & contact' }));
    var spares = el('textarea', { text: pages.support.spares || '' }); spares.style.minHeight = '60px';
    var phone = el('input', { type: 'text', value: pages.contact.phone || '' });
    var email = el('input', { type: 'text', value: pages.contact.email || '' });
    var address = el('textarea', { text: pages.contact.address || '' }); address.style.minHeight = '60px';
    panel.appendChild(lbl('Spares line')); panel.appendChild(spares);
    panel.appendChild(lbl('Phone')); panel.appendChild(phone);
    panel.appendChild(lbl('Email')); panel.appendChild(email);
    panel.appendChild(lbl('Address')); panel.appendChild(address);

    panel.appendChild(el('button', {
      class: 'abtn', text: 'Save page text', style: 'margin-top:24px;display:block',
      onclick: function () {
        pages.home = { heading: hHeading.value.trim(), lede: hLede.value.trim(), hero: pages.home.hero };
        pages.about.heading = aHeading.value.trim();
        pages.about.sections = sections.filter(function (s) { return s.side || (s.paras && s.paras.length); });
        pages.support.spares = spares.value.trim();
        pages.contact = { phone: phone.value.trim(), email: email.value.trim(), address: address.value.trim() };
        state.rows.pages = pages;
        saveRow('pages', panel);
      }
    }));
  }

  // Every product on the site, for linking instructions to product pages.
  function allProducts() {
    var out = [];
    state.keys.forEach(function (k) {
      var cat = state.rows[k];
      (cat.ranges || []).forEach(function (rg) {
        (rg.products || []).forEach(function (p) {
          out.push({
            key: cat.slug + '/' + rg.slug + '/' + p.slug,
            name: p.name, range: rg.title, category: cat.name,
            hay: (p.name + ' ' + rg.title + ' ' + cat.name + ' ' +
                  (p.variants || []).map(function (v) { return v.sku; }).join(' ')).toLowerCase()
          });
        });
      });
    });
    return out;
  }

  // A searchable checklist of every product, for one instruction document.
  function linkPicker(fileName, links, onSaved) {
    var box = el('div', { class: 'link-picker' });
    var chosen = {};
    (links[fileName] || []).forEach(function (k) { chosen[k] = true; });
    var products = allProducts();

    var head = el('div', { class: 'lp-head' });
    var search = el('input', { type: 'search', placeholder: 'Search products by name, range or order code' });
    head.appendChild(search);
    var tally = el('span', { class: 'lp-tally' });
    head.appendChild(tally);
    box.appendChild(head);

    var listEl = el('div', { class: 'lp-list' });
    box.appendChild(listEl);

    var updateTally = function () {
      var n = Object.keys(chosen).filter(function (k) { return chosen[k]; }).length;
      tally.textContent = n + ' selected';
    };

    var draw = function () {
      var q = (search.value || '').trim().toLowerCase();
      listEl.innerHTML = '';
      var shown = products.filter(function (p) { return !q || p.hay.indexOf(q) !== -1; });
      if (!shown.length) {
        listEl.appendChild(el('p', { class: 'small', style: 'padding:10px 2px', text: 'No products match that search.' }));
        return;
      }
      var lastGroup = '';
      shown.slice(0, 400).forEach(function (p) {
        var group = p.category + ' · ' + p.range;
        if (group !== lastGroup) {
          listEl.appendChild(el('p', { class: 'lp-group', text: group }));
          lastGroup = group;
        }
        var row = el('label', { class: 'lp-row' });
        var cb = el('input', { type: 'checkbox' });
        cb.checked = !!chosen[p.key];
        cb.addEventListener('change', function () {
          chosen[p.key] = cb.checked;
          updateTally();
        });
        row.appendChild(cb);
        row.appendChild(el('span', { class: 'lp-name', text: p.name }));
        listEl.appendChild(row);
      });
      if (shown.length > 400) {
        listEl.appendChild(el('p', { class: 'small', style: 'padding:8px 2px', text: 'Showing the first 400 — narrow the search to find others.' }));
      }
    };
    search.addEventListener('input', draw);
    draw();
    updateTally();

    var foot = el('div', { class: 'lp-foot' });
    foot.appendChild(el('button', {
      class: 'abtn abtn--sm', text: 'Save', onclick: function () {
        var keys = Object.keys(chosen).filter(function (k) { return chosen[k]; }).sort();
        if (keys.length) links[fileName] = keys; else delete links[fileName];
        state.rows.instruction_links = links;
        saveRowUpsert('instruction_links', box,
          keys.length ? 'Saved — this document now appears on ' + keys.length + ' product page' + (keys.length === 1 ? '' : 's') + '.'
                      : 'Saved — this document no longer appears on any product page.')
          .then(function () { if (onSaved) onSaved(); });
      }
    }));
    foot.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', text: 'Clear all', onclick: function () {
        chosen = {}; draw(); updateTally();
      }
    }));
    box.appendChild(foot);
    return box;
  }

  /* ---------- instructions tab ---------- */
  function renderInstructions(panel) {
    panel.appendChild(el('h3', { text: 'Instruction PDFs' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'The documents on the <b>Instructions</b> page. They are listed in filename order, each showing a picture of its first page. ' +
      'Name files “01 - …”, “02 - …” to control the order — the number is hidden from customers. ' +
      'Use <b>Show on products…</b> to tick which product pages a document should also appear on.' }));
    var list = el('div', { class: 'adm-list' });
    panel.appendChild(list);

    var links = {};
    var refresh = function () {
      list.innerHTML = '';
      Promise.all([
        sb.storage.from(cfg.instructionsBucket).list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } }),
        sb.from('site_content').select('data').eq('key', 'instruction_links').maybeSingle()
      ]).then(function (both) {
        var res = both[0];
        links = (both[1] && both[1].data && both[1].data.data) || {};
        state.rows.instruction_links = links;
        (res.data || []).filter(function (f) { return /\.pdf$/i.test(f.name); }).forEach(function (f) {
          var wrapRow = el('div', {});
          var item = el('div', { class: 'item' });
          var kb = f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) + ' KB' : '';
          var linked = (links[f.name] || []).length;
          var nm = el('span', { class: 'nm' });
          nm.appendChild(el('span', { text: f.name }));
          nm.appendChild(el('span', { class: 'dim', style: 'display:block;font-size:11.5px',
            text: kb + (linked ? ' · shown on ' + linked + ' product page' + (linked === 1 ? '' : 's') : ' · not shown on any product page') }));
          item.appendChild(nm);

          var panelSlot = el('div', {});
          item.appendChild(el('button', {
            class: 'abtn abtn--ghost abtn--sm', text: 'Show on products…',
            title: 'Choose which product pages this document appears on.',
            onclick: function () {
              if (panelSlot.firstChild) { panelSlot.innerHTML = ''; return; }
              panelSlot.appendChild(linkPicker(f.name, links, function () { refresh(); }));
            }
          }));
          item.appendChild(el('button', {
            class: 'abtn abtn--ghost abtn--sm', text: 'View',
            onclick: function () { window.open(cfg.supabaseUrl + '/storage/v1/object/public/' + cfg.instructionsBucket + '/' + encodeURIComponent(f.name), '_blank'); }
          }));
          item.appendChild(el('button', {
            class: 'abtn abtn--danger abtn--sm', text: 'Remove',
            onclick: function () {
              if (!confirm('Remove "' + f.name + '" from the site?')) return;
              sb.storage.from(cfg.instructionsBucket).remove([f.name]).then(function (r) {
                if (r.error) msg(panel, 'Could not remove: ' + r.error.message, 'err');
                else { msg(panel, 'Removed.', 'ok'); refresh(); }
              });
            }
          }));
          wrapRow.appendChild(item);
          wrapRow.appendChild(panelSlot);
          list.appendChild(wrapRow);
        });
        if (!list.children.length) list.appendChild(el('div', { class: 'item', html: '<span class="dim">No instruction PDFs yet.</span>' }));
      });
    };
    refresh();

    panel.appendChild(lbl('Upload PDF(s)', 'Choose one or more PDFs. They appear on the Instructions page straight away, ordered by filename — start names with 01, 02, 03 to control the order.'));
    var f = el('input', { type: 'file', accept: 'application/pdf', multiple: 'multiple' });
    panel.appendChild(f);
    f.addEventListener('change', function () {
      var files = Array.prototype.slice.call(f.files);
      if (!files.length) return;
      Promise.all(files.map(function (file) {
        return uploadWithProgress(cfg.instructionsBucket, file.name, file, 'Uploading ' + file.name, 'application/pdf')
          .then(function (t) { t.finish('Uploaded ' + file.name, true); return { error: null }; })
          .catch(function (e) { return { error: e }; });
      })).then(function (results) {
        var errs = results.filter(function (r) { return r.error; });
        if (errs.length) msg(panel, 'Some uploads failed: ' + errs[0].error.message, 'err');
        else msg(panel, files.length + ' file(s) uploaded and live.', 'ok');
        f.value = '';
        refresh();
      });
    });
  }

  /* ---------- photo gallery tab ---------- */
  function renderGallery(panel) {
    var shots = state.rows.gallery;
    if (!Array.isArray(shots)) { shots = []; state.rows.gallery = shots; }

    panel.appendChild(el('h3', { text: 'Photo gallery' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'Room photography for the product pages. Upload a shot, tag it, and tick the products that appear in it — ' +
      'it then shows in the picture strip on each of those product pages.' }));

    var up = el('div', { style: 'border:1px solid var(--line);background:var(--paper);padding:18px 22px' });
    up.appendChild(lbl('Add photographs'));
    var files = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple' });
    up.appendChild(files);
    up.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', text: 'Browse site files', style: 'margin-top:12px',
      title: 'Add a photograph already uploaded to the site.',
      onclick: function () {
        browseFiles({
          accept: 'image',
          folders: [
            { key: 'gallery', label: 'Gallery' },
            { key: 'lifestyle', label: 'Photography' },
            { key: 'inspiration', label: 'Inspiration' }
          ],
          onPick: function (path, name) {
            if (path.indexOf('gallery/') !== 0) {
              return msg(up, 'That file lives in another folder. Upload it here to use it in the gallery.', 'err');
            }
            if (shots.some(function (g) { return g.file === name; })) return msg(up, 'That photo is already in the gallery.', 'err');
            shots.unshift({ file: name, caption: '', tags: [], products: [] });
            saveRowUpsert('gallery', up, 'Added to the gallery.').then(draw);
          }
        });
      }
    }));
    panel.appendChild(up);

    files.addEventListener('change', function () {
      var list = Array.prototype.slice.call(files.files);
      if (!list.length) return;
      var done = 0;
      list.forEach(function (f) {
        uploadTo('gallery', f, 'Uploading ' + f.name).then(function (name) {
          if (!shots.some(function (g) { return g.file === name; })) {
            shots.unshift({ file: name, caption: '', tags: [], products: [] });
          }
          if (++done === list.length) {
            files.value = '';
            saveRowUpsert('gallery', panel, list.length + ' photo(s) added.').then(draw);
          }
        }).catch(function (e) { msg(panel, 'Upload failed: ' + e.message, 'err'); });
      });
    });

    panel.appendChild(el('hr', { class: 'rule' }));
    var filterRow = el('div', { class: 'adm-row' });
    var filter = el('input', { type: 'search', placeholder: 'Filter by file name, tag or product', style: 'max-width:420px' });
    filterRow.appendChild(filter);
    var count = el('span', { class: 'lp-tally' });
    filterRow.appendChild(count);
    panel.appendChild(filterRow);

    var grid = el('div', { class: 'gal-grid' });
    panel.appendChild(grid);

    function productNames() {
      var map = {};
      allProducts().forEach(function (p) { map[p.key] = p.name + ' · ' + p.range; });
      return map;
    }
    var names = productNames();

    function draw() {
      names = productNames();
      grid.innerHTML = '';
      var q = (filter.value || '').trim().toLowerCase();
      var shown = shots.filter(function (g) {
        if (!q) return true;
        var hay = (g.file + ' ' + (g.caption || '') + ' ' + (g.tags || []).join(' ') + ' ' +
                   (g.products || []).map(function (k) { return names[k] || k; }).join(' ')).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
      count.textContent = shown.length + (shown.length === 1 ? ' photo' : ' photos');
      if (!shots.length) {
        grid.appendChild(el('p', { class: 'small', text: 'No photographs yet — add some above.' }));
        return;
      }
      shown.forEach(function (g) {
        var idx = shots.indexOf(g);
        var card = el('div', { class: 'gal-card' });
        card.appendChild(el('div', { class: 'gal-shot', html: '' }));
        card.firstChild.appendChild(el('img', { src: cfg.assets + '/gallery/' + encodeURIComponent(g.file), alt: '', loading: 'lazy' }));
        var body = el('div', { class: 'gal-body' });
        body.appendChild(el('p', { class: 'gal-name', text: g.file }));

        var cap = el('input', { type: 'text', value: g.caption || '', placeholder: 'Caption (optional)' });
        cap.addEventListener('change', function () { g.caption = cap.value.trim(); });
        body.appendChild(cap);

        var tags = el('input', { type: 'text', value: (g.tags || []).join(', '), placeholder: 'Tags, separated by commas' });
        tags.addEventListener('change', function () {
          g.tags = tags.value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
        });
        body.appendChild(tags);

        var chosen = el('p', { class: 'small' });
        var setChosen = function () {
          chosen.textContent = (g.products || []).length
            ? 'Shown on ' + g.products.length + ' product page' + (g.products.length === 1 ? '' : 's')
            : 'Not shown on any product page yet';
        };
        setChosen();
        body.appendChild(chosen);

        var slot = el('div', {});
        body.appendChild(el('button', {
          class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Products in this photo',
          onclick: function () {
            if (slot.firstChild) { slot.innerHTML = ''; return; }
            slot.appendChild(productChecklist(g.products || [], null, function (list) {
              g.products = list; setChosen();
            }));
          }
        }));
        body.appendChild(slot);

        var actions = el('div', { class: 'adm-row', style: 'margin-top:12px' });
        actions.appendChild(el('button', {
          class: 'abtn abtn--sm', type: 'button', text: 'Save photo',
          onclick: function () { saveRowUpsert('gallery', card, 'Photo saved.'); }
        }));
        actions.appendChild(el('button', {
          class: 'abtn abtn--danger abtn--sm', type: 'button', text: 'Remove',
          onclick: function () {
            if (!confirm('Remove "' + g.file + '" from the gallery? The file stays in your site files.')) return;
            shots.splice(idx, 1);
            saveRowUpsert('gallery', panel, 'Photo removed.').then(draw);
          }
        }));
        body.appendChild(actions);
        card.appendChild(body);
        grid.appendChild(card);
      });
    }
    filter.addEventListener('input', draw);
    draw();
  }

  /* ---------- videos tab ---------- */
  function renderVideos(panel) {
    var videos = state.rows.videos;
    if (!Array.isArray(videos)) { videos = []; state.rows.videos = videos; }

    panel.appendChild(el('h3', { text: 'How-to videos' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'The cards on the <b>How-to videos</b> page, shown in the order below — use the ↑ and ↓ buttons to rearrange them. ' +
      'Each card opens its YouTube link in a new tab.' }));
    var list = el('div', { class: 'adm-list' });
    panel.appendChild(list);

    var persist = function () { return saveRowUpsert('videos', panel); };
    var draw = function () {
      list.innerHTML = '';
      videos.forEach(function (v, i) {
        var item = el('div', { class: 'item' });
        var th = el('div', { class: 'thumb', style: 'width:54px;height:54px;background:var(--tile);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none' });
        if (v.thumb) th.appendChild(el('img', { src: cfg.assets + '/videos/' + encodeURIComponent(v.thumb), alt: '', style: 'width:100%;height:100%;object-fit:cover' }));
        item.appendChild(th);
        item.appendChild(el('span', { class: 'nm', html: '' }));
        item.querySelector('.nm').appendChild(el('span', { text: v.title }));
        item.querySelector('.nm').appendChild(el('span', { class: 'dim', style: 'display:block;font-size:11.5px', text: v.url }));
        item.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', text: '↑', onclick: function () { if (i > 0) { videos.splice(i - 1, 0, videos.splice(i, 1)[0]); draw(); persist(); } } }));
        item.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', text: '↓', onclick: function () { if (i < videos.length - 1) { videos.splice(i + 1, 0, videos.splice(i, 1)[0]); draw(); persist(); } } }));
        item.appendChild(el('button', {
          class: 'abtn abtn--danger abtn--sm', text: 'Remove',
          onclick: function () {
            if (!confirm('Remove "' + v.title + '" from the site?')) return;
            videos.splice(i, 1);
            draw();
            persist();
          }
        }));
        list.appendChild(item);
      });
      if (!videos.length) list.appendChild(el('div', { class: 'item', html: '<span class="dim">No videos yet — add the first one below.</span>' }));
    };
    draw();

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Add a video' }));
    var title = el('input', { type: 'text', placeholder: 'How to remove a flow regulator' });
    var url = el('input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=…' });
    var thumbFile = el('input', { type: 'file', accept: 'image/*' });
    panel.appendChild(lbl('Title')); panel.appendChild(title);
    panel.appendChild(lbl('YouTube link')); panel.appendChild(url);
    panel.appendChild(lbl('Thumbnail image')); panel.appendChild(thumbFile);
    panel.appendChild(el('button', {
      class: 'abtn', text: 'Add video', style: 'margin-top:20px;display:block',
      onclick: function () {
        var t = title.value.trim(), u = url.value.trim();
        if (!t) return msg(panel, 'Please give the video a title.', 'err');
        if (!/^https?:\/\//.test(u)) return msg(panel, 'Please paste the full YouTube link (starting https://).', 'err');
        if (!thumbFile.files[0]) return msg(panel, 'Please choose a thumbnail image.', 'err');
        uploadTo('videos', thumbFile.files[0]).then(function (fname) {
          videos.push({ title: t, url: u, thumb: fname });
          title.value = url.value = ''; thumbFile.value = '';
          draw();
          return persist();
        }).catch(function (e) { msg(panel, 'Thumbnail upload failed: ' + e.message, 'err'); });
      }
    }));
  }

  /* ---------- retailers tab ---------- */
  function renderRetailers(panel) {
    var retailers = state.rows.retailers;
    if (!Array.isArray(retailers)) { retailers = []; state.rows.retailers = retailers; }
    var persist = function (okText) { return saveRowUpsert('retailers', panel, okText); };

    panel.appendChild(el('h3', { text: 'Retailers' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'Everyone listed here appears as a pin on the <b>Find a retailer</b> map and in the list beside it. ' +
      'To add one: press <b>New retailer</b>, fill in the details, type the postcode, press <b>Locate from postcode</b>, then <b>Add retailer</b>.' }));

    var filter = el('input', { type: 'text', placeholder: 'Filter by name, town or postcode', style: 'max-width:420px' });
    panel.appendChild(filter);
    var list = el('div', { class: 'adm-list' });
    panel.appendChild(list);

    // Geocode a UK postcode with postcodes.io (free, no key).
    function locate(pc) {
      var q = String(pc || '').trim();
      if (!q) return Promise.resolve(null);
      return fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.status === 200 && j.result) return { lat: j.result.latitude, lng: j.result.longitude };
          return fetch('https://api.postcodes.io/outcodes/' + encodeURIComponent(q.split(' ')[0]))
            .then(function (r) { return r.json(); })
            .then(function (o) { return (o.status === 200 && o.result) ? { lat: o.result.latitude, lng: o.result.longitude } : null; });
        }).catch(function () { return null; });
    }

    function editor(r, isNew, onDone) {
      var box = el('div', { style: 'border:1px solid var(--line);background:var(--paper);padding:18px 22px;margin:10px 0' });
      var name = el('input', { type: 'text', value: r.name || '' });
      var address = el('input', { type: 'text', value: r.address || '' });
      var town = el('input', { type: 'text', value: r.town || '' });
      var county = el('input', { type: 'text', value: r.county || '' });
      var postcode = el('input', { type: 'text', value: r.postcode || '' });
      var phone = el('input', { type: 'text', value: r.phone || '' });
      var website = el('input', { type: 'text', value: r.website || '' });
      var lat = el('input', { type: 'text', value: r.lat != null ? r.lat : '' });
      var lng = el('input', { type: 'text', value: r.lng != null ? r.lng : '' });
      box.appendChild(lbl('Retailer name')); box.appendChild(name);
      box.appendChild(lbl('Street address')); box.appendChild(address);
      box.appendChild(lbl('Town')); box.appendChild(town);
      box.appendChild(lbl('County')); box.appendChild(county);
      box.appendChild(lbl('Postcode', 'Used to place the pin on the map. Type it, then press “Locate from postcode” below.')); box.appendChild(postcode);
      box.appendChild(lbl('Phone')); box.appendChild(phone);
      box.appendChild(lbl('Website')); box.appendChild(website);
      box.appendChild(lbl('Map position', 'Where the pin sits. Press “Locate from postcode” to fill this in automatically. Only type numbers here if the postcode is not recognised.'));
      var geo = el('div', { class: 'adm-row' });
      lat.style.maxWidth = '150px'; lng.style.maxWidth = '150px';
      geo.appendChild(lat); geo.appendChild(lng);
      var status = el('span', { class: 'small' });
      geo.appendChild(el('button', {
        class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Locate from postcode',
        onclick: function () {
          status.textContent = 'Looking up…';
          locate(postcode.value).then(function (pt) {
            if (!pt) { status.textContent = 'Postcode not recognised — enter the position by hand.'; return; }
            lat.value = pt.lat; lng.value = pt.lng;
            status.textContent = 'Found.';
          });
        }
      }));
      geo.appendChild(status);
      box.appendChild(geo);

      box.appendChild(el('button', {
        class: 'abtn', type: 'button', text: isNew ? 'Add retailer' : 'Save retailer', style: 'margin-top:20px',
        onclick: function () {
          if (!name.value.trim()) return msg(box, 'Please give the retailer a name.', 'err');
          var la = parseFloat(lat.value), ln = parseFloat(lng.value);
          var apply = function (pt) {
            if (pt) { la = pt.lat; ln = pt.lng; }
            if (isNaN(la) || isNaN(ln)) return msg(box, 'This retailer needs a map position — press “Locate from postcode”, or type the position by hand.', 'err');
            r.name = name.value.trim(); r.address = address.value.trim();
            r.town = town.value.trim(); r.county = county.value.trim();
            r.postcode = postcode.value.trim(); r.phone = phone.value.trim();
            r.website = website.value.trim(); r.lat = la; r.lng = ln;
            if (isNew) retailers.push(r);
            retailers.sort(function (a, b) { return (a.town || '').toLowerCase().localeCompare((b.town || '').toLowerCase()) || (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()); });
            persist(isNew ? 'Retailer added — live on the map.' : 'Retailer saved — live on the map.').then(onDone);
          };
          if ((isNaN(la) || isNaN(ln)) && postcode.value.trim()) locate(postcode.value).then(apply);
          else apply(null);
        }
      }));
      box.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Cancel', style: 'margin-top:10px', onclick: onDone }));
      return box;
    }

    var draw = function () {
      list.innerHTML = '';
      var q = filter.value.trim().toLowerCase();
      var matched = 0;
      retailers.forEach(function (r, i) {
        var hay = (r.name + ' ' + (r.town || '') + ' ' + (r.postcode || '') + ' ' + (r.county || '')).toLowerCase();
        if (q && hay.indexOf(q) === -1) return;
        matched++;
        if (matched > 60 && q === '') return;
        var item = el('div', { class: 'item' });
        var nm = el('span', { class: 'nm' });
        nm.appendChild(el('span', { text: r.name }));
        nm.appendChild(el('span', { class: 'dim', style: 'display:block;font-size:11.5px', text: [r.town, r.postcode].filter(Boolean).join(', ') + (r.lat == null ? '  ⚠ no map position' : '') }));
        item.appendChild(nm);
        item.appendChild(el('button', {
          class: 'abtn abtn--ghost abtn--sm', text: 'Edit',
          onclick: function () {
            var ed = editor(r, false, function () { draw(); });
            item.parentNode.insertBefore(ed, item.nextSibling);
            item.style.display = 'none';
          }
        }));
        item.appendChild(el('button', {
          class: 'abtn abtn--danger abtn--sm', text: 'Remove',
          onclick: function () {
            if (!confirm('Remove "' + r.name + '" from the retailer map?')) return;
            retailers.splice(i, 1);
            draw();
            persist('Retailer removed.');
          }
        }));
        list.appendChild(item);
      });
      if (!matched) list.appendChild(el('div', { class: 'item', html: '<span class="dim">' + (retailers.length ? 'No retailers match that filter.' : 'No retailers yet — add the first one below.') + '</span>' }));
      else if (!q && matched > 60) list.appendChild(el('div', { class: 'item', html: '<span class="dim">Showing the first 60 of ' + retailers.length + ' — use the filter to find a specific retailer.</span>' }));
    };
    filter.addEventListener('input', draw);
    draw();

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Add a retailer' }));
    var addSlot = el('div', {});
    panel.appendChild(addSlot);
    panel.appendChild(el('button', {
      class: 'abtn', text: 'New retailer', style: 'margin-top:14px',
      onclick: function () {
        addSlot.innerHTML = '';
        addSlot.appendChild(editor({}, true, function () { addSlot.innerHTML = ''; draw(); }));
      }
    }));
  }

  /* ---------- guarantee registrations tab ---------- */
  var GUAR = { rows: null, q: '', sort: 'created_at', dir: 'desc', open: {} };

  var GUARANTEE_SQL = [
    'create table if not exists public.guarantee_registrations (',
    '  id bigserial primary key,',
    '  created_at timestamptz not null default now(),',
    '  title text, first_name text not null, last_name text not null, email text not null,',
    '  address1 text not null, address2 text, town text not null, postcode text not null, country text,',
    '  retailer_name text not null, purchase_date date not null,',
    '  developer_name text, moved_in_date date,',
    '  installer_name text, installer_address1 text, installer_address2 text,',
    '  installer_town text, installer_postcode text, installer_country text,',
    "  products jsonb not null default '[]'::jsonb,",
    '  proof_file text, notes text,',
    "  status text not null default 'new'",
    ');',
    '',
    'create index if not exists guarantee_created_idx on public.guarantee_registrations (created_at desc);',
    '',
    'alter table public.guarantee_registrations enable row level security;',
    '',
    '-- customers may register; only the signed-in admin can read',
    'create policy "anyone may register a guarantee" on public.guarantee_registrations',
    '  for insert to anon with check (true);',
    'create policy "admin reads registrations" on public.guarantee_registrations',
    '  for select to authenticated using (true);',
    'create policy "admin updates registrations" on public.guarantee_registrations',
    '  for update to authenticated using (true) with check (true);',
    '',
    '-- a private bucket for proof-of-purchase uploads',
    "insert into storage.buckets (id, name, public) values ('guarantee-proof','guarantee-proof', false)",
    '  on conflict (id) do nothing;',
    'create policy "anyone may attach proof" on storage.objects',
    "  for insert to anon with check (bucket_id = 'guarantee-proof');",
    'create policy "admin reads proof" on storage.objects',
    "  for select to authenticated using (bucket_id = 'guarantee-proof');"
  ].join('\n');

  function renderGuarantees(panel) {
    panel.appendChild(el('h3', { text: 'Guarantee registrations' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'Everything customers submit on the <b>Register your guarantee</b> page. ' +
      'Search by any detail, and click a row to open the full registration.' }));

    var tools = el('div', { class: 'adm-row' });
    var search = el('input', { type: 'search', placeholder: 'Search name, email, postcode, retailer or product code', style: 'max-width:460px' });
    tools.appendChild(search);
    var count = el('span', { class: 'lp-tally' });
    tools.appendChild(count);
    var exportBtn = el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Export CSV', title: 'Download everything shown as a spreadsheet file.' });
    tools.appendChild(exportBtn);
    panel.appendChild(tools);

    var host = el('div', { class: 'guar-wrap' });
    panel.appendChild(host);
    host.appendChild(el('p', { class: 'small', text: 'Loading registrations…' }));

    function load() {
      sb.from('guarantee_registrations').select('*').order('created_at', { ascending: false }).limit(5000)
        .then(function (res) {
          if (res.error) return setupNeeded(host, res.error);
          GUAR.rows = res.data || [];
          draw();
        });
    }

    function setupNeeded(target, error) {
      target.innerHTML = '';
      var missing = /guarantee_registrations/i.test(error.message || '') || error.code === 'PGRST205' || error.code === '42P01';
      var card = el('div', { class: 'dash-note warn' });
      if (missing) {
        card.appendChild(el('p', { html: '<b>Guarantee registrations are not switched on yet.</b>' }));
        card.appendChild(el('p', { class: 'small', style: 'margin-top:8px', text:
          'The registration page is built and ready, but the table that stores submissions does not exist yet. ' +
          'Open your Supabase project → SQL Editor, paste the block below and run it once. ' +
          'Until then the form tells customers to phone or email instead, so nothing is lost.' }));
        card.appendChild(el('pre', { class: 'dash-sql', text: GUARANTEE_SQL }));
        var copy = el('button', { class: 'abtn abtn--sm', text: 'Copy the SQL', onclick: function () {
          navigator.clipboard.writeText(GUARANTEE_SQL).then(function () {
            copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = 'Copy the SQL'; }, 2000);
          });
        } });
        card.appendChild(copy);
      } else {
        card.appendChild(el('p', { text: 'Could not load registrations: ' + (error.message || 'unknown error') }));
      }
      target.appendChild(card);
    }

    function matches(r) {
      if (!GUAR.q) return true;
      var hay = [r.first_name, r.last_name, r.email, r.town, r.postcode, r.retailer_name,
                 r.developer_name, r.installer_name, r.country, r.status,
                 (r.products || []).map(function (p) { return (p.code || '') + ' ' + (p.description || ''); }).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(GUAR.q) !== -1;
    }

    function fmtDate(d) {
      if (!d) return '—';
      var dt = new Date(d);
      if (isNaN(dt)) return d;
      return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function draw() {
      host.innerHTML = '';
      var rows = (GUAR.rows || []).filter(matches);
      rows.sort(function (a, b) {
        var x = a[GUAR.sort], y = b[GUAR.sort];
        if (x == null) return 1;
        if (y == null) return -1;
        var r = String(x).localeCompare(String(y), undefined, { numeric: true });
        return GUAR.dir === 'desc' ? -r : r;
      });
      count.textContent = rows.length + (rows.length === 1 ? ' registration' : ' registrations');

      if (!(GUAR.rows || []).length) {
        host.appendChild(el('div', { class: 'dash-note', html:
          '<b>No registrations yet.</b><p class="small" style="margin-top:8px">' +
          'They will appear here the moment a customer completes the form.</p>' }));
        return;
      }
      if (!rows.length) {
        host.appendChild(el('p', { class: 'small', text: 'Nothing matches that search.' }));
        return;
      }

      var table = el('table', { class: 'guar' });
      var thead = el('thead');
      var htr = el('tr');
      [['created_at', 'Registered'], ['last_name', 'Customer'], ['email', 'Email'],
       ['postcode', 'Postcode'], ['retailer_name', 'Retailer'], ['purchase_date', 'Purchased'],
       ['products', 'Products'], ['status', 'Status']].forEach(function (c) {
        var th = el('th', { text: c[1] });
        if (c[0] !== 'products') {
          th.className = 'sortable' + (GUAR.sort === c[0] ? ' on ' + GUAR.dir : '');
          th.addEventListener('click', function () {
            if (GUAR.sort === c[0]) GUAR.dir = GUAR.dir === 'desc' ? 'asc' : 'desc';
            else { GUAR.sort = c[0]; GUAR.dir = 'desc'; }
            draw();
          });
        }
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = el('tbody');
      rows.forEach(function (r) {
        var tr = el('tr', { class: 'guar-row' + (GUAR.open[r.id] ? ' open' : '') });
        var cells = [
          fmtDate(r.created_at),
          [r.title, r.first_name, r.last_name].filter(Boolean).join(' '),
          r.email,
          r.postcode,
          r.retailer_name,
          fmtDate(r.purchase_date),
          String((r.products || []).length),
          r.status || 'new'
        ];
        cells.forEach(function (c, i) {
          var td = el('td', { text: c });
          if (i === 7) { td.innerHTML = ''; td.appendChild(el('span', { class: 'pill pill--' + (r.status || 'new'), text: r.status || 'new' })); }
          tr.appendChild(td);
        });
        tr.addEventListener('click', function () {
          GUAR.open[r.id] = !GUAR.open[r.id];
          draw();
        });
        tbody.appendChild(tr);

        if (GUAR.open[r.id]) {
          var dtr = el('tr', { class: 'guar-detail' });
          var td = el('td', { colspan: '8' });
          td.appendChild(detail(r));
          dtr.appendChild(td);
          tbody.appendChild(dtr);
        }
      });
      table.appendChild(tbody);
      host.appendChild(table);
    }

    function block(title, pairs) {
      var b = el('div', { class: 'guar-block' });
      b.appendChild(el('h4', { text: title }));
      var dl = el('dl');
      pairs.forEach(function (p) {
        if (!p[1]) return;
        dl.appendChild(el('dt', { text: p[0] }));
        dl.appendChild(el('dd', { text: p[1] }));
      });
      if (!dl.children.length) dl.appendChild(el('dd', { class: 'dim', text: 'Not supplied' }));
      b.appendChild(dl);
      return b;
    }

    function detail(r) {
      var wrap = el('div', { class: 'guar-detail-inner' });
      var grid = el('div', { class: 'guar-blocks' });
      grid.appendChild(block('Customer', [
        ['Name', [r.title, r.first_name, r.last_name].filter(Boolean).join(' ')],
        ['Email', r.email],
        ['Registered', fmtDate(r.created_at)]
      ]));
      grid.appendChild(block('Address', [
        ['Address', [r.address1, r.address2].filter(Boolean).join(', ')],
        ['Town / City', r.town], ['Postcode', r.postcode], ['Country', r.country]
      ]));
      grid.appendChild(block('Purchase', [
        ['Retailer', r.retailer_name], ['Purchase date', fmtDate(r.purchase_date)],
        ['Builder / developer', r.developer_name], ['Moved in', fmtDate(r.moved_in_date)]
      ]));
      grid.appendChild(block('Installer', [
        ['Name', r.installer_name],
        ['Address', [r.installer_address1, r.installer_address2].filter(Boolean).join(', ')],
        ['Town / City', r.installer_town], ['Postcode', r.installer_postcode], ['Country', r.installer_country]
      ]));
      wrap.appendChild(grid);

      var prods = el('div', { class: 'guar-block', style: 'margin-top:18px' });
      prods.appendChild(el('h4', { text: 'Products registered' }));
      if ((r.products || []).length) {
        var pt = el('table', { class: 'guar-products' });
        var hb = el('tr'); hb.appendChild(el('th', { text: 'Code' })); hb.appendChild(el('th', { text: 'Description' }));
        pt.appendChild(hb);
        r.products.forEach(function (p) {
          var row = el('tr');
          row.appendChild(el('td', { text: p.code || '—' }));
          row.appendChild(el('td', { text: p.description || '—' }));
          pt.appendChild(row);
        });
        prods.appendChild(pt);
      } else {
        prods.appendChild(el('p', { class: 'small', text: 'No products listed.' }));
      }
      wrap.appendChild(prods);

      if (r.proof_file) {
        var pf = el('div', { class: 'guar-block', style: 'margin-top:18px' });
        pf.appendChild(el('h4', { text: 'Proof of purchase' }));
        var link = el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Open proof', onclick: function (e) {
          e.stopPropagation();
          sb.storage.from('guarantee-proof').createSignedUrl(r.proof_file, 300).then(function (res) {
            if (res.data && res.data.signedUrl) window.open(res.data.signedUrl, '_blank');
            else toast('Could not open that file', 'err');
          });
        } });
        pf.appendChild(link);
        wrap.appendChild(pf);
      }

      var actions = el('div', { class: 'adm-row', style: 'margin-top:20px' });
      ['new', 'checked', 'registered'].forEach(function (st) {
        actions.appendChild(el('button', {
          class: 'abtn abtn--ghost abtn--sm' + ((r.status || 'new') === st ? ' on' : ''),
          text: st.charAt(0).toUpperCase() + st.slice(1),
          onclick: function (e) {
            e.stopPropagation();
            sb.from('guarantee_registrations').update({ status: st }).eq('id', r.id).then(function (res) {
              if (res.error) return toast('Could not update: ' + res.error.message, 'err');
              r.status = st;
              toast('Marked as ' + st, 'ok');
              draw();
            });
          }
        }));
      });
      actions.appendChild(el('a', {
        class: 'abtn abtn--ghost abtn--sm', href: 'mailto:' + r.email, text: 'Email customer',
        onclick: function (e) { e.stopPropagation(); }
      }));
      wrap.appendChild(actions);
      wrap.addEventListener('click', function (e) { e.stopPropagation(); });
      return wrap;
    }

    search.addEventListener('input', function () { GUAR.q = search.value.trim().toLowerCase(); draw(); });
    exportBtn.addEventListener('click', function () {
      var rows = (GUAR.rows || []).filter(matches);
      if (!rows.length) return toast('Nothing to export', 'err');
      var cols = ['created_at','title','first_name','last_name','email','address1','address2','town','postcode','country',
                  'retailer_name','purchase_date','developer_name','moved_in_date','installer_name','installer_address1',
                  'installer_address2','installer_town','installer_postcode','installer_country','status'];
      var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var lines = [cols.concat(['products']).map(esc).join(',')];
      rows.forEach(function (r) {
        var prod = (r.products || []).map(function (p) { return (p.code || '') + ' — ' + (p.description || ''); }).join(' | ');
        lines.push(cols.map(function (c) { return esc(r[c]); }).concat([esc(prod)]).join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'armera-guarantee-registrations.csv';
      a.click();
      toast('Exported ' + rows.length + ' registration(s)', 'ok');
    });

    load();
  }

  /* ---------- brochure (catalogue) tab ---------- */
  function renderBrochure(panel) {
    var pages = state.rows.pages || {};
    state.rows.pages = pages;
    var cat = pages.catalogue || {};

    panel.appendChild(el('h3', { text: 'Catalogue' }));
    panel.appendChild(el('p', { class: 'tab-intro', html:
      'The brochure behind every <b>“View the catalogue”</b> link on the site — top bar, homepage, products, about, support, contact and footer. ' +
      'Upload a new edition here and all of them change at once, cover picture included.' }));

    var current = el('div', { class: 'imgrow', style: 'grid-template-columns:110px 1fr;align-items:start' });
    var cover = el('div', { class: 'thumb', style: 'width:110px;height:150px' });
    if (cat.cover) cover.appendChild(el('img', { src: cfg.assets + '/documents/' + encodeURIComponent(cat.cover), alt: '', style: 'width:100%;height:100%;object-fit:cover' }));
    else cover.appendChild(el('span', { text: '—' }));
    current.appendChild(cover);
    var info = el('div', {});
    info.appendChild(el('p', { text: cat.label || 'No catalogue set' }));
    info.appendChild(el('p', { class: 'small', text: cat.file || '' }));
    if (cat.file) {
      info.appendChild(el('a', {
        class: 'abtn abtn--ghost abtn--sm', style: 'margin-top:10px;display:inline-block',
        href: cfg.assets + '/documents/' + encodeURIComponent(cat.file), target: '_blank', rel: 'noopener', text: 'View current catalogue'
      }));
    }
    current.appendChild(info);
    panel.appendChild(current);

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Upload a new edition' }));
    var label = el('input', { type: 'text', value: cat.label || '', placeholder: 'e.g. September 2026 Collection' });
    var file = el('input', { type: 'file', accept: 'application/pdf' });
    panel.appendChild(lbl('Edition name')); panel.appendChild(label);
    panel.appendChild(lbl('Catalogue PDF', 'Upload the new catalogue and every “View the catalogue” link on the site points at it immediately. The cover picture is taken from page 1 automatically.')); panel.appendChild(file);

    var status = el('p', { class: 'small', style: 'margin-top:12px' });
    panel.appendChild(status);

    // Render page 1 of the uploaded PDF to a JPEG cover using the vendored pdf.js.
    function makeCover(fileObj) {
      return import(cfg.assets + '/vendor/pdfjs/pdf.min.mjs').then(function (pdfjs) {
        pdfjs.GlobalWorkerOptions.workerSrc = cfg.assets + '/vendor/pdfjs/pdf.worker.min.mjs';
        return fileObj.arrayBuffer().then(function (buf) {
          return pdfjs.getDocument({ data: buf }).promise;
        }).then(function (doc) { return doc.getPage(1); }).then(function (page) {
          var vp = page.getViewport({ scale: 1 });
          vp = page.getViewport({ scale: 900 / vp.width });
          var canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
            .then(function () {
              return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', 0.88); });
            });
        });
      });
    }

    panel.appendChild(el('button', {
      class: 'abtn', text: 'Upload catalogue', style: 'margin-top:20px;display:block',
      onclick: function () {
        var f = file.files[0];
        if (!f) return msg(panel, 'Please choose the catalogue PDF.', 'err');
        if (!label.value.trim()) return msg(panel, 'Please name this edition.', 'err');
        var pdfName = slugify(f.name.replace(/\.pdf$/i, '')) + '.pdf';
        var coverName = pdfName.replace(/\.pdf$/, '') + '.cover.jpg';
        status.textContent = 'Uploading the PDF…';
        msg(panel, '');
        uploadWithProgress('site-assets', 'documents/' + pdfName, f, 'Uploading the catalogue', 'application/pdf')
          .then(function (t) {
            t.finish('Catalogue uploaded', true);
            status.textContent = 'Making the cover image…';
            return makeCover(f).catch(function () { return null; });
          })
          .then(function (blob) {
            if (!blob) return null;
            return uploadWithProgress('site-assets', 'documents/' + coverName, blob, 'Saving the cover image', 'image/jpeg')
              .then(function (t2) { t2.finish('Cover image saved', true); return coverName; })
              .catch(function () { return null; });
          })
          .then(function (savedCover) {
            pages.catalogue = { file: pdfName, label: label.value.trim(), cover: savedCover || cat.cover || null };
            status.textContent = '';
            return saveRow('pages', panel, 'Catalogue updated — every catalogue link on the site now points at this edition.');
          })
          .then(function () { renderShell(); })
          .catch(function (e) {
            status.textContent = '';
            msg(panel, 'Upload failed: ' + (e.message || e), 'err');
          });
      }
    }));
  }

  /* ---------- account tab ---------- */
  function renderAccount(panel) {
    panel.appendChild(el('p', { class: 'tab-intro', text: 'Your sign-in details for this control panel.' }));
    panel.appendChild(el('h3', { text: 'Your name' }));
    var nm = el('input', { type: 'text', value: displayName() });
    panel.appendChild(lbl('Display name'));
    panel.appendChild(nm);
    panel.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', text: 'Update name', style: 'margin-top:14px;display:block',
      onclick: function () {
        sb.auth.updateUser({ data: { display_name: nm.value.trim() } }).then(function (res) {
          if (res.error) return msg(panel, res.error.message, 'err');
          if (res.data && res.data.user) state.user = res.data.user;
          renderShell();
        });
      }
    }));
    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'Change password' }));
    var p1 = el('input', { type: 'password', autocomplete: 'new-password' });
    var p2 = el('input', { type: 'password', autocomplete: 'new-password' });
    panel.appendChild(lbl('New password')); panel.appendChild(p1);
    panel.appendChild(el('p', { class: 'hint', text: 'At least 8 characters.' }));
    panel.appendChild(lbl('Repeat new password')); panel.appendChild(p2);
    panel.appendChild(el('button', {
      class: 'abtn', text: 'Update password', style: 'margin-top:22px;display:block',
      onclick: function () {
        if (p1.value.length < 8) return msg(panel, 'Password must be at least 8 characters.', 'err');
        if (p1.value !== p2.value) return msg(panel, 'Passwords do not match.', 'err');
        sb.auth.updateUser({ password: p1.value }).then(function (res) {
          if (res.error) msg(panel, res.error.message, 'err');
          else { p1.value = p2.value = ''; msg(panel, 'Password updated.', 'ok'); }
        });
      }
    }));
  }


  /* ---------- sections, and the tiles you pin to the front ---------- */
  // key, name, one line for the tile, and a thin line drawing.
  var SECTIONS = [
    ['catalogue', 'Products', 'Ranges, products, options and prices',
      'M12 3l8 4v10l-8 4-8-4V7z|M4 7l8 4 8-4|M12 11v10'],
    ['pages', 'Pages', 'Wording, the homepage picture and the news banner',
      'M6 3h8l4 4v14H6z|M14 3v4h4|M9 12h6|M9 16h6'],
    ['guarantees', 'Guarantees', 'Registrations sent in by customers',
      'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z|M9 12l2 2 4-4'],
    ['instructions', 'Instructions', 'Fitting instruction PDFs',
      'M5 6h14|M5 12h14|M5 18h9'],
    ['retailers', 'Retailers', 'The stockists shown on the map',
      'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z|M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
    ['gallery', 'Photo gallery', 'Photographs, and which products they show',
      'M3 5h18v14H3z|M3 16l5-5 4 4 3-3 6 6|M8.5 9.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z'],
    ['videos', 'Videos', 'How-to films on the support pages',
      'M3 6h18v12H3z|M10 9.5l5 2.5-5 2.5z'],
    ['brochure', 'Catalogue', 'The catalogue PDF used by every link',
      'M4 5h7v15H4z|M13 5h7v15h-7z'],
    ['dashboard', 'Dashboard', 'Visitor figures and how the site is doing',
      'M4 20V11|M10 20V4|M16 20v-6|M22 20H2'],
    ['account', 'Account', 'Your name and your password',
      'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M4 21c1.4-3.9 4.8-6 8-6s6.6 2.1 8 6']
  ];
  var DEFAULT_PINS = ['catalogue', 'pages', 'guarantees', 'instructions'];

  function section(key) {
    for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === key) return SECTIONS[i];
    return null;
  }
  function icon(paths, size) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 26); svg.setAttribute('height', size || 26);
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.2'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    paths.split('|').forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }
  function pins() {
    var m = (state.user && state.user.user_metadata) || {};
    var list = m.admin_pins;
    if (!Array.isArray(list)) return DEFAULT_PINS.slice();
    return list.filter(section);
  }
  function setPins(list) {
    // Show the change at once; the account record catches up behind it.
    state.user = state.user || {};
    state.user.user_metadata = state.user.user_metadata || {};
    state.user.user_metadata.admin_pins = list;
    renderShell();
    sb.auth.updateUser({ data: { admin_pins: list } }).then(function (res) {
      if (res.error) toast('Could not save your tiles: ' + res.error.message, 'err');
    });
  }
  function togglePin(key) {
    var list = pins(), i = list.indexOf(key);
    if (i === -1) { list.push(key); toast(section(key)[1] + ' pinned to quick access', 'ok'); }
    else { list.splice(i, 1); toast(section(key)[1] + ' removed from quick access', 'ok'); }
    setPins(list);
  }
  function openSection(key) {
    state.tab = key; state.editing = null; state.menuOpen = false;
    renderShell();
    window.scrollTo(0, 0);
  }
  function star(key, isPinned) {
    var b = el('button', {
      class: 'qa-pin' + (isPinned ? ' on' : ''), type: 'button',
      title: isPinned ? 'Remove from quick access' : 'Pin to quick access',
      'aria-label': (isPinned ? 'Remove ' : 'Pin ') + section(key)[1],
      text: isPinned ? '★' : '☆'
    });
    b.addEventListener('click', function (e) { e.stopPropagation(); togglePin(key); });
    return b;
  }

  /* ---------- quick access ---------- */
  function renderHome(panel) {
    var list = pins();
    var grid = el('div', { class: 'qa-grid' });

    list.forEach(function (key) {
      var sec = section(key);
      var tile = el('div', { class: 'qa-tile', role: 'button', tabindex: '0' });
      tile.appendChild(el('span', { class: 'qa-ico' }, [icon(sec[3], 30)]));
      tile.appendChild(el('span', { class: 'qa-name', text: sec[1] }));
      tile.appendChild(el('span', { class: 'qa-blurb', text: sec[2] }));
      tile.appendChild(star(key, true));
      tile.addEventListener('click', function () { openSection(key); });
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSection(key); }
      });
      grid.appendChild(tile);
    });

    var add = el('div', { class: 'qa-tile qa-tile--add', role: 'button', tabindex: '0' });
    add.appendChild(el('span', { class: 'qa-ico' }, [icon('M12 5v14|M5 12h14', 30)]));
    add.appendChild(el('span', { class: 'qa-name', text: list.length ? 'Add a tile' : 'Choose your tiles' }));
    add.appendChild(el('span', { class: 'qa-blurb', text: 'Pick the parts of the site you use most' }));
    var openMenu = function () { state.menuOpen = true; renderShell(); };
    add.addEventListener('click', openMenu);
    add.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); }
    });
    grid.appendChild(add);

    panel.appendChild(grid);
    panel.appendChild(el('p', { class: 'qa-foot', text: list.length
      ? 'Everything else is under Menu, top right.'
      : 'Everything is under Menu, top right — pin the parts you use often and they will appear here.' }));
  }

  /* ---------- the menu that holds everything ---------- */
  function menuPanel() {
    var m = el('div', { class: 'adm-menu' });
    var list = pins();

    var homeRow = el('button', { class: 'mrow' + (state.tab === 'home' ? ' on' : ''), type: 'button' });
    homeRow.appendChild(el('span', { class: 'mrow-ico' }, [icon('M4 11l8-7 8 7|M6 10v10h12V10', 20)]));
    homeRow.appendChild(el('span', { class: 'mrow-name', text: 'Quick access' }));
    homeRow.addEventListener('click', function () { openSection('home'); });
    m.appendChild(homeRow);
    m.appendChild(el('div', { class: 'mdiv' }));

    SECTIONS.forEach(function (sec) {
      var pinned = list.indexOf(sec[0]) !== -1;
      var row = el('div', { class: 'mrow' + (state.tab === sec[0] ? ' on' : '') });
      var go = el('button', { class: 'mrow-go', type: 'button' });
      go.appendChild(el('span', { class: 'mrow-ico' }, [icon(sec[3], 20)]));
      go.appendChild(el('span', { class: 'mrow-name', text: sec[1] }));
      go.addEventListener('click', function () { openSection(sec[0]); });
      row.appendChild(go);
      row.appendChild(star(sec[0], pinned));
      m.appendChild(row);
    });
    return m;
  }

  /* ---------- boot ---------- */
  function boot() {
    root.innerHTML = '<p class="small">Loading…</p>';
    Promise.all([loadContent(), sb.auth.getUser()]).then(function (res) {
      state.user = res[1] && res[1].data && res[1].data.user;
      renderShell();
    }).catch(function (e) {
      renderLogin('Could not load content: ' + (e.message || e));
    });
  }

  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) boot();
    else renderLogin();
  });
})();
