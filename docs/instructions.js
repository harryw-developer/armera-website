// Lists instruction PDFs from Supabase storage and renders first-page thumbnails.
// PDFs uploaded to the "instructions" bucket appear here automatically, ordered by filename.
(async function () {
  var cfg = window.ARMERA;
  var grid = document.getElementById('pdf-grid');
  var empty = document.getElementById('pdf-empty');
  if (!grid || !cfg) return;

  var files = [];
  try {
    var res = await fetch(cfg.supabaseUrl + '/storage/v1/object/list/' + cfg.instructionsBucket, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: 'Bearer ' + cfg.anonKey
      },
      body: JSON.stringify({ prefix: '', limit: 500, sortBy: { column: 'name', order: 'asc' } })
    });
    files = (await res.json()) || [];
  } catch (e) {
    files = [];
  }
  files = (Array.isArray(files) ? files : []).filter(function (f) {
    return f && f.name && /\.pdf$/i.test(f.name);
  });
  files.sort(function (a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });

  if (!files.length) {
    empty.style.display = 'block';
    return;
  }

  function titleOf(name) {
    return name
      .replace(/\.pdf$/i, '')
      .replace(/^\s*\d+[\s._-]+/, '')
      .replace(/[_]+/g, ' ')
      .trim();
  }

  var cards = files.map(function (f) {
    var url = cfg.supabaseUrl + '/storage/v1/object/public/' + cfg.instructionsBucket + '/' + encodeURIComponent(f.name);
    var a = document.createElement('a');
    a.className = 'pdf-card';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    var kb = f.metadata && f.metadata.size ? Math.round(f.metadata.size / 1024) : null;
    a.innerHTML =
      '<div class="thumb"><span class="ph">PDF</span></div>' +
      '<div class="body"><h4></h4><p>' + (kb ? kb + ' KB — PDF' : 'PDF') + '</p></div>';
    a.querySelector('h4').textContent = titleOf(f.name);
    grid.appendChild(a);
    return { url: url, el: a, name: f.name, title: titleOf(f.name) };
  });

  // Filter by document name or by the products an instruction is linked to.
  var linkText = {};
  try {
    var linkRows = await fetch(cfg.supabaseUrl + '/rest/v1/site_content?key=eq.instruction_links&select=data', {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
    }).then(function (r) { return r.json(); });
    var links = (linkRows && linkRows[0] && linkRows[0].data) || {};
    var catRows = await fetch(cfg.supabaseUrl + '/rest/v1/site_content?select=key,data', {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
    }).then(function (r) { return r.json(); });
    var nameOf = {};
    (catRows || []).filter(function (r) { return /^\d\d-/.test(r.key); }).forEach(function (row) {
      (row.data.ranges || []).forEach(function (rg) {
        (rg.products || []).forEach(function (p) {
          nameOf[row.data.slug + '/' + rg.slug + '/' + p.slug] = p.name + ' ' + rg.title;
        });
      });
    });
    Object.keys(links).forEach(function (file) {
      linkText[file] = (links[file] || []).map(function (k) { return nameOf[k] || k; }).join(' ');
    });
  } catch (e) { /* filtering falls back to the document name */ }

  var searchEl = document.getElementById('pdf-search');
  var countEl = document.getElementById('pdf-count');
  var noneEl = document.getElementById('pdf-none');
  function applyFilter() {
    var q = (searchEl.value || '').trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var hay = (c.title + ' ' + c.name + ' ' + (linkText[c.name] || '')).toLowerCase();
      var hit = !q || hay.indexOf(q) !== -1;
      c.el.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    countEl.textContent = shown + (shown === 1 ? ' document' : ' documents');
    noneEl.style.display = shown ? 'none' : 'block';
  }
  if (searchEl) {
    searchEl.addEventListener('input', applyFilter);
    applyFilter();
  }

  // Render first-page thumbnails with pdf.js (hosted on Supabase storage)
  try {
    var pdfjs = await import(cfg.assets + '/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = cfg.assets + '/vendor/pdfjs/pdf.worker.min.mjs';
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        pdfjs.getDocument({ url: card.url }).promise.then(function (doc) {
          return doc.getPage(1);
        }).then(function (page) {
          var viewport = page.getViewport({ scale: 1 });
          var scale = 480 / viewport.width;
          viewport = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
            var t = card.el.querySelector('.thumb');
            t.innerHTML = '';
            t.appendChild(canvas);
          });
        }).catch(function () { /* keep placeholder */ });
      })(cards[i]);
    }
  } catch (e) { /* thumbnails unavailable; placeholders remain */ }
})();
