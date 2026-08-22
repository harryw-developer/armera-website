// ARMERA site admin — edit the catalogue, page text and instruction PDFs.
// Data lives in Supabase (site_content table + storage buckets); the public
// site reads it at runtime, so changes here are live immediately.
(function () {
  var cfg = window.ARMERA;
  var root = document.getElementById('admin-root');
  if (!root || !cfg || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

  var state = { rows: {}, keys: [], tab: 'catalogue', catKey: null, rangeIdx: 0, editing: null, user: null };

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
  var msg = function (target, text, cls) {
    var old = target.querySelector('.adm-msg');
    if (old) old.remove();
    if (text) target.appendChild(el('p', { class: 'adm-msg ' + (cls || ''), text: text }));
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
  function uploadTo(folder, file) {
    var name = slugify(file.name.replace(/\.[^.]+$/, '')) + file.name.match(/\.[^.]+$/)[0].toLowerCase();
    return sb.storage.from('site-assets').upload(folder + '/' + name, file, { upsert: true, cacheControl: '3600' })
      .then(function (res) {
        if (res.error) throw res.error;
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
    [['catalogue', 'Products'], ['pages', 'Pages'], ['retailers', 'Retailers'], ['instructions', 'Instructions'], ['videos', 'Videos'], ['brochure', 'Catalogue'], ['account', 'Account']].forEach(function (t) {
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

    if (state.tab === 'catalogue') renderCatalogue(panel);
    if (state.tab === 'pages') renderPages(panel);
    if (state.tab === 'instructions') renderInstructions(panel);
    if (state.tab === 'videos') renderVideos(panel);
    if (state.tab === 'retailers') renderRetailers(panel);
    if (state.tab === 'brochure') renderBrochure(panel);
    if (state.tab === 'account') renderAccount(panel);
  }

  /* ---------- catalogue tab ---------- */
  function renderCatalogue(panel) {
    var cat = state.rows[state.catKey];
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
      class: 'abtn abtn--ghost abtn--sm', text: 'Add range',
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
      class: 'abtn abtn--danger abtn--sm', text: 'Delete range',
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
    var lbl = function (t) { return el('label', { text: t }); };
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
    d.appendChild(lbl('Page title')); d.appendChild(title);
    d.appendChild(lbl('Tagline')); d.appendChild(tagline);
    d.appendChild(lbl('Footnote (optional)')); d.appendChild(footnote);
    d.appendChild(lbl('Hero image — current: ' + ((range.hero && range.hero.img) || 'none') + ' (upload to replace)'));
    d.appendChild(heroFile);
    d.appendChild(lbl('Hero caption')); d.appendChild(heroCap);

    /* swatches */
    d.appendChild(lbl('Colours (code · name · swatch image)'));
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
    panel.appendChild(el('label', { text: 'Products in ' + range.title }));
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
    box.appendChild(el('p', { class: 'hint', text: 'Page address: /products/…/' + range.slug + '/' + p.slug + '/' }));
    var lbl = function (t) { return el('label', { text: t }); };

    var name = el('input', { type: 'text', value: p.name });
    var dims = el('input', { type: 'text', value: p.dims || '' });
    var note = el('textarea', { text: p.note || '' }); note.style.minHeight = '60px';
    var footnote = el('textarea', { text: p.footnote || '' }); footnote.style.minHeight = '60px';
    box.appendChild(lbl('Name')); box.appendChild(name);
    box.appendChild(lbl('Dimensions (e.g. 600w x 520h x 460d — leave blank if not applicable)')); box.appendChild(dims);
    box.appendChild(lbl('Note shown on the product page (optional)')); box.appendChild(note);
    box.appendChild(lbl('Footnote (optional)')); box.appendChild(footnote);

    /* variants (drawn first — the photo slots below follow the option rows) */
    box.appendChild(lbl('Options & pricing (code · finish/option · colour code · RRP £)'));
    var vWrap = el('div', {});
    var variants = p.variants.map(function (v) { return Object.assign({}, v); });
    var imagesByCode = Object.assign({}, p.imagesByCode || {});
    var singleImage = p.image || null;

    var drawImages = function () {}; // redefined below; re-run when option colour codes change
    var drawV = function () {
      vWrap.innerHTML = '';
      variants.forEach(function (v, i) {
        var r = el('div', { class: 'vrow' });
        var sku = el('input', { type: 'text', value: v.sku || '', placeholder: 'AT.620.600.11' });
        var fin = el('input', { type: 'text', value: v.finish || '', placeholder: 'Graphite grey' });
        var code = el('input', { type: 'text', value: v.code || '', placeholder: 'colour' });
        var price = el('input', { type: 'number', value: v.price || 0, min: '0', step: '1' });
        sku.addEventListener('input', function () { v.sku = sku.value.trim(); });
        fin.addEventListener('input', function () { v.finish = fin.value; });
        fin.addEventListener('change', function () { drawImages(); });
        code.addEventListener('input', function () { v.code = code.value.trim(); });
        code.addEventListener('change', function () { drawImages(); });
        price.addEventListener('input', function () { v.price = +price.value; });
        r.appendChild(sku); r.appendChild(fin); r.appendChild(code); r.appendChild(price);
        r.appendChild(el('button', { class: 'abtn abtn--danger abtn--sm', type: 'button', text: '×', onclick: function () { variants.splice(i, 1); drawV(); drawImages(); } }));
        vWrap.appendChild(r);
      });
    };
    drawV();
    box.appendChild(vWrap);
    box.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Add option', onclick: function () { variants.push({ sku: '', finish: '', price: 0 }); drawV(); drawImages(); } }));
    box.appendChild(el('p', { class: 'hint', text: 'Give an option a colour code (a short label such as 11 or blue) and a photo slot for that colour appears below. Leave the code blank for finishes that share one photo. Use the same code under Range details → Colours so the colour swatch shows too.' }));

    /* photos — one slot per colour code, or a single slot when no codes are used */
    box.appendChild(lbl('Photos'));
    var imgWrap = el('div', {});
    box.appendChild(imgWrap);

    var thumbFor = function (fname) {
      var t = el('div', { class: 'thumb' });
      if (fname) t.appendChild(el('img', { src: cfg.assets + '/products/' + encodeURIComponent(fname), alt: '' }));
      else t.appendChild(el('span', { text: '—' }));
      return t;
    };
    var codesInUse = function () {
      var seen = [], out = [];
      variants.forEach(function (v) {
        if (v.code && seen.indexOf(v.code) === -1) {
          seen.push(v.code);
          out.push({ code: v.code, label: v.finish || 'Code ' + v.code });
        }
      });
      return out;
    };
    drawImages = function () {
      imgWrap.innerHTML = '';
      var codes = codesInUse();
      if (codes.length) {
        codes.forEach(function (c) {
          var row = el('div', { class: 'imgrow' });
          row.appendChild(thumbFor(imagesByCode[c.code]));
          row.appendChild(el('span', { class: 'small', text: c.label + (imagesByCode[c.code] ? '' : ' — needs a photo') }));
          var f = el('input', { type: 'file', accept: 'image/*' });
          f.addEventListener('change', function () {
            if (!f.files[0]) return;
            uploadTo('products', f.files[0]).then(function (fname) {
              imagesByCode[c.code] = fname;
              drawImages();
              msg(box, c.label + ' photo uploaded — remember to Save product.', 'ok');
            }).catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
          });
          row.appendChild(f);
          imgWrap.appendChild(row);
        });
      } else {
        var row = el('div', { class: 'imgrow' });
        row.appendChild(thumbFor(singleImage));
        row.appendChild(el('span', { class: 'small', text: singleImage ? 'Product photo' : 'No photo yet' }));
        var f = el('input', { type: 'file', accept: 'image/*' });
        f.addEventListener('change', function () {
          if (!f.files[0]) return;
          uploadTo('products', f.files[0]).then(function (fname) {
            singleImage = fname;
            drawImages();
            msg(box, 'Photo uploaded — remember to Save product.', 'ok');
          }).catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
        });
        row.appendChild(f);
        imgWrap.appendChild(row);
      }
    };
    drawImages();

    var save = el('button', {
      class: 'abtn', text: 'Save product', type: 'button', style: 'margin-top:22px;display:block',
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
        // persist photos: keep only images for colour codes still in use
        var okText;
        var codes = codesInUse().map(function (c) { return c.code; });
        if (codes.length) {
          p.imagesByCode = {};
          codes.forEach(function (c) { if (imagesByCode[c]) p.imagesByCode[c] = imagesByCode[c]; });
          if (!Object.keys(p.imagesByCode).length) delete p.imagesByCode;
          delete p.image;
          var missing = codesInUse().filter(function (c) { return !imagesByCode[c.code]; });
          if (missing.length) okText = 'Saved. Note: ' + missing.map(function (c) { return c.label; }).join(', ') + ' still need' + (missing.length === 1 ? 's' : '') + ' a photo — another image will stand in until one is uploaded.';
        } else {
          if (singleImage) p.image = singleImage; else delete p.image;
          delete p.imagesByCode;
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
    var lbl = function (t) { return el('label', { text: t }); };

    panel.appendChild(el('h3', { text: 'Homepage' }));
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
    panel.appendChild(lbl('Phone (shown site-wide)')); panel.appendChild(phone);
    panel.appendChild(lbl('Email (shown site-wide)')); panel.appendChild(email);
    panel.appendChild(lbl('Address')); panel.appendChild(address);

    panel.appendChild(el('button', {
      class: 'abtn', text: 'Save page text', style: 'margin-top:24px;display:block',
      onclick: function () {
        pages.home = { heading: hHeading.value.trim(), lede: hLede.value.trim() };
        pages.about.heading = aHeading.value.trim();
        pages.about.sections = sections.filter(function (s) { return s.side || (s.paras && s.paras.length); });
        pages.support.spares = spares.value.trim();
        pages.contact = { phone: phone.value.trim(), email: email.value.trim(), address: address.value.trim() };
        state.rows.pages = pages;
        saveRow('pages', panel);
      }
    }));
  }

  /* ---------- instructions tab ---------- */
  function renderInstructions(panel) {
    panel.appendChild(el('h3', { text: 'Instruction PDFs' }));
    panel.appendChild(el('p', { class: 'hint', text: 'These appear on the public Instructions page in filename order, each with a thumbnail of its first page. Start filenames with a number to control the order, e.g. “01 - Holloway furniture.pdf”.' }));
    var list = el('div', { class: 'adm-list' });
    panel.appendChild(list);

    var refresh = function () {
      list.innerHTML = '';
      sb.storage.from(cfg.instructionsBucket).list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } }).then(function (res) {
        (res.data || []).filter(function (f) { return /\.pdf$/i.test(f.name); }).forEach(function (f) {
          var item = el('div', { class: 'item' });
          var kb = f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) + ' KB' : '';
          item.appendChild(el('span', { class: 'nm', html: f.name + ' <span class="dim">' + kb + '</span>' }));
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
          list.appendChild(item);
        });
        if (!list.children.length) list.appendChild(el('div', { class: 'item', html: '<span class="dim">No instruction PDFs yet.</span>' }));
      });
    };
    refresh();

    panel.appendChild(el('label', { text: 'Upload PDF(s)' }));
    var f = el('input', { type: 'file', accept: 'application/pdf', multiple: 'multiple' });
    panel.appendChild(f);
    f.addEventListener('change', function () {
      var files = Array.prototype.slice.call(f.files);
      if (!files.length) return;
      Promise.all(files.map(function (file) {
        return sb.storage.from(cfg.instructionsBucket).upload(file.name, file, { upsert: true, cacheControl: '3600' });
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
    panel.appendChild(el('p', { class: 'hint', text: 'These appear on the public How-to videos page in this order. Each card shows the uploaded thumbnail and opens the YouTube link.' }));
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
    var lbl = function (t) { return el('label', { text: t }); };
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
    var lbl = function (t) { return el('label', { text: t }); };
    var persist = function (okText) { return saveRowUpsert('retailers', panel, okText); };

    panel.appendChild(el('h3', { text: 'Retailers' }));
    panel.appendChild(el('p', { class: 'hint', text: 'These appear as pins on the Find a retailer map. Postcodes are turned into map positions automatically — press “Locate” after typing one.' }));

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
      box.appendChild(lbl('Postcode')); box.appendChild(postcode);
      box.appendChild(lbl('Phone')); box.appendChild(phone);
      box.appendChild(lbl('Website')); box.appendChild(website);
      box.appendChild(lbl('Map position'));
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
    var lbl = function (t) { return el('label', { text: t }); };

    panel.appendChild(el('h3', { text: 'Catalogue' }));
    panel.appendChild(el('p', { class: 'hint', text: 'Upload a new edition and every “View the catalogue” link across the site — homepage, products, about, support, contact, footer and top bar — points at it straight away. The cover image is taken from the PDF’s first page automatically.' }));

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
    panel.appendChild(lbl('Edition name (shown beside the catalogue)')); panel.appendChild(label);
    panel.appendChild(lbl('Catalogue PDF')); panel.appendChild(file);

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
        sb.storage.from('site-assets').upload('documents/' + pdfName, f, { upsert: true, cacheControl: '3600', contentType: 'application/pdf' })
          .then(function (res) {
            if (res.error) throw res.error;
            status.textContent = 'Making the cover image…';
            return makeCover(f).catch(function () { return null; });
          })
          .then(function (blob) {
            if (!blob) return null;
            return sb.storage.from('site-assets').upload('documents/' + coverName, blob, { upsert: true, cacheControl: '3600', contentType: 'image/jpeg' })
              .then(function (res) { return res.error ? null : coverName; });
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
    panel.appendChild(el('h3', { text: 'Your name' }));
    var nm = el('input', { type: 'text', value: displayName() });
    panel.appendChild(el('label', { text: 'Display name (used for the greeting)' }));
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
    var lbl = function (t) { return el('label', { text: t }); };
    var p1 = el('input', { type: 'password', autocomplete: 'new-password' });
    var p2 = el('input', { type: 'password', autocomplete: 'new-password' });
    panel.appendChild(lbl('New password (minimum 8 characters)')); panel.appendChild(p1);
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
