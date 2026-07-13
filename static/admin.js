// ARMERA site admin — edit the catalogue, page text and instruction PDFs.
// Data lives in Supabase (site_content table + storage buckets); the public
// site reads it at runtime, so changes here are live immediately.
(function () {
  var cfg = window.ARMERA;
  var root = document.getElementById('admin-root');
  if (!root || !cfg || !window.supabase) return;
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);

  var state = { rows: {}, keys: [], tab: 'catalogue', catKey: null, rangeIdx: 0, editing: null };

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
  function renderShell() {
    root.innerHTML = '';
    var wrap = el('div', { class: 'adm' });
    var head = el('div', { class: 'adm-head' });
    head.appendChild(el('div', { html: '<span class="eyebrow">ARMERA</span><h1 style="margin-top:10px;font-size:34px">Site admin</h1>' }));
    var out = el('button', { class: 'abtn abtn--ghost abtn--sm', text: 'Sign out', onclick: function () { sb.auth.signOut().then(function () { renderLogin(); }); } });
    head.appendChild(out);
    wrap.appendChild(head);

    var tabs = el('div', { class: 'adm-tabs' });
    [['catalogue', 'Catalogue'], ['pages', 'Pages'], ['instructions', 'Instructions'], ['account', 'Account']].forEach(function (t) {
      tabs.appendChild(el('button', {
        class: state.tab === t[0] ? 'on' : '', text: t[1],
        onclick: function () { state.tab = t[0]; state.editing = null; renderShell(); }
      }));
    });
    wrap.appendChild(tabs);

    var panel = el('div', { class: 'adm-panel' });
    wrap.appendChild(panel);
    root.appendChild(wrap);

    if (state.tab === 'catalogue') renderCatalogue(panel);
    if (state.tab === 'pages') renderPages(panel);
    if (state.tab === 'instructions') renderInstructions(panel);
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

    /* images */
    var hasCodes = !!p.imagesByCode;
    if (hasCodes && range.swatches) {
      box.appendChild(lbl('Product photos per colour (upload to replace)'));
      range.swatches.forEach(function (s) {
        var r = el('div', { class: 'adm-row', style: 'margin-bottom:8px' });
        r.appendChild(el('span', { class: 'small', style: 'width:140px', text: s.name + ' (' + (p.imagesByCode[s.code] || 'none') + ')' }));
        var f = el('input', { type: 'file', accept: 'image/*' });
        f.addEventListener('change', function () {
          if (!f.files[0]) return;
          uploadTo('products', f.files[0]).then(function (fname) { p.imagesByCode[s.code] = fname; msg(box, s.name + ' photo uploaded.', 'ok'); })
            .catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
        });
        r.appendChild(f);
        box.appendChild(r);
      });
    } else {
      box.appendChild(lbl('Product photo — current: ' + (p.image || 'none') + ' (upload to replace)'));
      var f = el('input', { type: 'file', accept: 'image/*' });
      f.addEventListener('change', function () {
        if (!f.files[0]) return;
        uploadTo('products', f.files[0]).then(function (fname) { p.image = fname; msg(box, 'Photo uploaded.', 'ok'); })
          .catch(function (e) { msg(box, 'Upload failed: ' + e.message, 'err'); });
      });
      box.appendChild(f);
    }

    /* variants */
    box.appendChild(lbl('Options & pricing (code · finish/option · colour code · RRP £)'));
    var vWrap = el('div', {});
    var variants = p.variants.map(function (v) { return Object.assign({}, v); });
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
        code.addEventListener('input', function () { v.code = code.value.trim(); });
        price.addEventListener('input', function () { v.price = +price.value; });
        r.appendChild(sku); r.appendChild(fin); r.appendChild(code); r.appendChild(price);
        r.appendChild(el('button', { class: 'abtn abtn--danger abtn--sm', type: 'button', text: '×', onclick: function () { variants.splice(i, 1); drawV(); } }));
        vWrap.appendChild(r);
      });
    };
    drawV();
    box.appendChild(vWrap);
    box.appendChild(el('button', { class: 'abtn abtn--ghost abtn--sm', type: 'button', text: 'Add option', onclick: function () { variants.push({ sku: '', finish: '', price: 0 }); drawV(); } }));
    box.appendChild(el('p', { class: 'hint', text: 'The colour code links an option to a colour swatch and its photo (furniture only) — leave blank for brassware finishes.' }));

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
        saveRow(state.catKey, box);
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
    var hEyebrow = el('input', { type: 'text', value: pages.home.eyebrow || '' });
    var hHeading = el('input', { type: 'text', value: pages.home.heading || '' });
    var hLede = el('textarea', { text: pages.home.lede || '' });
    panel.appendChild(lbl('Small line above the heading')); panel.appendChild(hEyebrow);
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
        pages.home = { eyebrow: hEyebrow.value.trim(), heading: hHeading.value.trim(), lede: hLede.value.trim() };
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

  /* ---------- account tab ---------- */
  function renderAccount(panel) {
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
    loadContent().then(renderShell).catch(function (e) {
      renderLogin('Could not load content: ' + (e.message || e));
    });
  }

  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) boot();
    else renderLogin();
  });
})();
