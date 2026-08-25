// ARMERA site admin — edit the catalogue, page text and instruction PDFs.
// Data lives in Supabase (site_content table + storage buckets); the public
// site reads it at runtime, so changes here are live immediately.
(function () {
  var cfg = window.ARMERA;
  var root = document.getElementById('admin-root');
  if (!root || !cfg || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

  var state = { rows: {}, keys: [], tab: 'dashboard', catKey: null, rangeIdx: 0, editing: null, user: null };

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
  // lbl('Name', 'The product name as customers see it — e.g. “600mm 2 drawer wall hung unit”.') or lbl('Name', 'what this field does')
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
    var head = el('div', { class: 'adm-head' });
    var hd = el('div', {});
    hd.appendChild(el('span', { class: 'eyebrow', text: 'ARMERA — Site admin' }));
    hd.appendChild(el('h1', { style: 'margin-top:10px;font-size:34px', text: greeting() }));
    head.appendChild(hd);
    var out = el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Sign out', onclick: function () { sb.auth.signOut().then(function () { renderLogin(); }); } });
    head.appendChild(out);
    wrap.appendChild(head);

    var tabs = el('div', { class: 'adm-tabs' });
    [['dashboard', 'Dashboard'], ['catalogue', 'Products'], ['pages', 'Pages'], ['retailers', 'Retailers'], ['instructions', 'Instructions'], ['videos', 'Videos'], ['brochure', 'Catalogue'], ['account', 'Account']].forEach(function (t) {
      tabs.appendChild(el('button', {
        class: state.tab === t[0] ? 'on' : '', text: t[1],
        onclick: function () { state.tab = t[0]; state.editing = null; renderShell(); }
      }));
    });
    wrap.appendChild(tabs);

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

    if (state.tab === 'dashboard') renderDashboard(panel);
    if (state.tab === 'catalogue') renderCatalogue(panel);
    if (state.tab === 'pages') renderPages(panel);
    if (state.tab === 'instructions') renderInstructions(panel);
    if (state.tab === 'videos') renderVideos(panel);
    if (state.tab === 'retailers') renderRetailers(panel);
    if (state.tab === 'brochure') renderBrochure(panel);
    if (state.tab === 'account') renderAccount(panel);
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
    row.appendChild(hq('The eight top-level sections of the site — Furniture & Basins, WCs, Taps and so on.', 'left'));
    row.appendChild(rangeSel);
    row.appendChild(hq('The families inside the chosen category — Atoll, Palladium, Holloway and so on.', 'left'));
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
    d.appendChild(lbl('Range name', 'The short name shown in menus and on tiles — e.g. “Atoll”. Keep it to the family name.')); d.appendChild(name);
    d.appendChild(lbl('Page title', 'The heading at the top of the range page — usually the range name plus the type, e.g. “Atoll furniture”.')); d.appendChild(title);
    d.appendChild(lbl('Tagline', 'One line of description under the heading, and on the tile that links here. Straight from the catalogue is ideal.')); d.appendChild(tagline);
    d.appendChild(lbl('Footnote (optional)', 'Small print shown under the products in this range — e.g. “These cabinets require handles to be ordered separately.”')); d.appendChild(footnote);
    d.appendChild(lbl('Hero image', 'The wide lifestyle photo across the top of the range page. Landscape photos work best. Current file: ' + ((range.hero && range.hero.img) || 'none') + '. Choosing a file replaces it.'));
    d.appendChild(heroFile);
    d.appendChild(lbl('Hero caption', 'The small caption over the bottom-right of the hero photo, describing what is pictured.')); d.appendChild(heroCap);

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
    var ph = lbl('Products in ' + range.title, 'Every product in this range. “Edit” opens its details, prices and photos. “Remove” deletes it from the site.');
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
    box.appendChild(lbl('Name', 'The product name as customers see it — e.g. “600mm 2 drawer wall hung unit”.')); box.appendChild(name);
    box.appendChild(lbl('Dimensions', 'Shown under the product name. Use the catalogue format, e.g. 600w x 520h x 460d. “mm” is added automatically. Leave blank if not applicable.')); box.appendChild(dims);
    box.appendChild(lbl('Note (optional)', 'A short note in a bordered box on the product page — e.g. “Price excludes ceramic basin.”')); box.appendChild(note);
    box.appendChild(lbl('Footnote (optional)', 'Small print shown under the products in this range — e.g. “These cabinets require handles to be ordered separately.”')); box.appendChild(footnote);

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
    panel.appendChild(lbl('Banner wording', 'Keep it to one short line — it is centred across the full width of the page.'));
    panel.appendChild(bText);

    var colRow = el('div', { class: 'adm-row', style: 'margin-top:18px' });
    var bBg = el('input', { type: 'color', value: b.bg || '#232220' });
    var bFg = el('input', { type: 'color', value: b.fg || '#f4f1e9' });
    var mk = function (labelText, input, tip) {
      var w = el('label', { class: 'colour-pick' });
      w.appendChild(el('span', { text: labelText }));
      w.appendChild(input);
      w.appendChild(hq(tip));
      return w;
    };
    colRow.appendChild(mk('Background', bBg, 'The colour of the strip itself.'));
    colRow.appendChild(mk('Text', bFg, 'The colour of the wording. Keep it well apart from the background so it stays easy to read.'));
    var bSize = el('input', { type: 'number', min: '11', max: '28', value: b.size || 14, style: 'max-width:90px' });
    colRow.appendChild(mk('Size (px)', bSize, 'Text size in pixels. 14 is the default.'));
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
    panel.appendChild(lbl('Top of the homepage', 'The full-width picture behind the headline. You can use a photograph or a short video — a video plays automatically, silently, on a loop.'));
    var heroNow = el('p', { class: 'small', text: hero.file ? (hero.type === 'video' ? 'Currently a video: ' : 'Currently a photo: ') + hero.file : 'Currently the original photograph.' });
    panel.appendChild(heroNow);
    var heroType = el('select', {});
    [['image', 'Photograph'], ['video', 'Video']].forEach(function (o) {
      var opt = el('option', { value: o[0], text: o[1] });
      if ((hero.type || 'image') === o[0]) opt.selected = true;
      heroType.appendChild(opt);
    });
    var heroRow = el('div', { class: 'adm-row', style: 'margin-top:10px' });
    heroRow.appendChild(heroType);
    var heroFile = el('input', { type: 'file', accept: 'image/*,video/mp4,video/webm' });
    heroRow.appendChild(heroFile);
    panel.appendChild(heroRow);
    panel.appendChild(el('p', { class: 'hint', text: 'Landscape works best. For video, an MP4 of ten to twenty seconds under about 10 MB keeps the page quick to load — it plays without sound.' }));
    panel.appendChild(el('button', {
      class: 'abtn abtn--ghost abtn--sm', text: 'Save top of homepage', style: 'margin-top:12px;display:block',
      onclick: function () {
        if (!heroFile.files[0]) {
          hero.type = heroType.value;
          state.rows.pages = pages;
          return saveRow('pages', panel, 'Saved.');
        }
        var f = heroFile.files[0];
        var isVideo = /^video\//.test(f.type) || heroType.value === 'video';
        uploadTo('lifestyle', f).then(function (name) {
          hero.file = name;
          hero.type = isVideo ? 'video' : 'image';
          state.rows.pages = pages;
          saveRow('pages', panel, 'Saved — the top of the homepage now uses ' + name + '.').then(function () { renderShell(); });
        }).catch(function (e) { msg(panel, 'Upload failed: ' + e.message, 'err'); });
      }
    }));
    panel.appendChild(el('hr', { class: 'rule' }));

    var hHeading = el('input', { type: 'text', value: pages.home.heading || '' });
    var hLede = el('textarea', { text: pages.home.lede || '' });
    panel.appendChild(lbl('Main heading', 'The large headline over the photo at the top of the homepage.')); panel.appendChild(hHeading);
    panel.appendChild(lbl('Intro sentence', 'The sentence under the homepage headline. One or two lines reads best.')); panel.appendChild(hLede);

    panel.appendChild(el('hr', { class: 'rule' }));
    panel.appendChild(el('h3', { text: 'About page' }));
    var aHeading = el('input', { type: 'text', value: pages.about.heading || '' });
    panel.appendChild(lbl('Heading', 'The main heading at the top of the About page.')); panel.appendChild(aHeading);
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
    panel.appendChild(lbl('Spares line', 'Shown on the Support page and the Contact page. Include the phone number you want people to ring for spares.')); panel.appendChild(spares);
    panel.appendChild(lbl('Phone', 'Used in the top bar, footer and Contact page. Changing it here updates every one of them, and the click-to-call links.')); panel.appendChild(phone);
    panel.appendChild(lbl('Email', 'Used in the top bar, footer and Contact page, including the click-to-email links.')); panel.appendChild(email);
    panel.appendChild(lbl('Address', 'Shown in the footer and on the Contact page.')); panel.appendChild(address);

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
    panel.appendChild(lbl('Title', 'Shown across the top of the video card — e.g. “How to remove a flow regulator”.')); panel.appendChild(title);
    panel.appendChild(lbl('YouTube link', 'Paste the full link from YouTube’s address bar, starting https://. Clicking the card opens it in a new tab.')); panel.appendChild(url);
    panel.appendChild(lbl('Thumbnail image', 'The picture on the video card. A still from the video works well — landscape images are cropped to a tall card.')); panel.appendChild(thumbFile);
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
      box.appendChild(lbl('Retailer name', 'The business name as it should appear on the map pin and in the list.')); box.appendChild(name);
      box.appendChild(lbl('Street address', 'Street and building only — the town, county and postcode go in their own boxes below.')); box.appendChild(address);
      box.appendChild(lbl('Town', 'Customers can search by town, so spell it as people would type it.')); box.appendChild(town);
      box.appendChild(lbl('County', 'Optional. Shown after the town in the retailer’s address.')); box.appendChild(county);
      box.appendChild(lbl('Postcode', 'Used to place the pin on the map. Type it, then press “Locate from postcode” below.')); box.appendChild(postcode);
      box.appendChild(lbl('Phone', 'Shown on the retailer’s card and pin, as a tap-to-call link.')); box.appendChild(phone);
      box.appendChild(lbl('Website', 'Full address including https:// — it opens in a new tab.')); box.appendChild(website);
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
    panel.appendChild(lbl('Edition name', 'Shown next to the catalogue across the site — e.g. “September 2026 Collection”.')); panel.appendChild(label);
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
    panel.appendChild(lbl('Display name', 'Just the name used to greet you at the top of this page.'));
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
    panel.appendChild(lbl('New password', 'At least 8 characters. You will use this with your email address to sign in next time.')); panel.appendChild(p1);
    panel.appendChild(lbl('Repeat new password', 'Type the same password again so nothing is mistyped.')); panel.appendChild(p2);
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
