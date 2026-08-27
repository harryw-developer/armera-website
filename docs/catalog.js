// Renders the /products tree from the Supabase site_content table.
// Content is editable in the admin area; changes appear here without a rebuild.
(function () {
  var cfg = window.ARMERA;
  var root = document.getElementById('catalog');
  if (!root || !cfg) return;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var u = function (p) { return (cfg.base || '') + p; };
  var money = function (n) { return '£' + Number(n).toLocaleString('en-GB'); };
  var prodImg = function (f) { return cfg.assets + '/products/' + f; };
  var swatchImg = function (f) { return cfg.assets + '/swatches/' + f; };
  var lifeImg = function (f) { return cfg.assets + '/lifestyle/' + String(f).replace(/\.png$/, '.jpg'); };

  function spread(p) {
    var prices = p.variants.map(function (v) { return v.price; });
    var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
    return { min: min, max: max, single: min === max };
  }
  function fromLabel(p) {
    var s = spread(p);
    return s.single ? money(s.min) : 'From ' + money(s.min);
  }
  function mainImage(p) {
    return p.image || (p.imagesByCode ? p.imagesByCode[Object.keys(p.imagesByCode)[0]] : null);
  }
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  function prodImgSafe(f) { return f ? prodImg(f) : BLANK; }
  function codeImage(p, code) { return (p.imagesByCode && p.imagesByCode[code]) || mainImage(p); }
  // Each variant carries its own photo; fall back through colour code then product.
  function variantImage(p, v) {
    return v.image || (v.code && p.imagesByCode && p.imagesByCode[v.code]) || mainImage(p);
  }
  // Generic finish swatches for brassware and accessories.
  function finishSwatch(name) {
    var f = String(name || '').toLowerCase();
    if (/matt\s*white/.test(f)) return 'finish-matt-white.png';
    if (/matt\s*black/.test(f)) return 'finish-matt-black.png';
    if (/brushed\s*black/.test(f)) return 'finish-black.png';
    if (/brushed\s*gold|^gold/.test(f)) return 'finish-gold.png';
    if (/stainless/.test(f)) return 'finish-stainless.png';
    if (/chrome/.test(f)) return 'finish-chrome.png';
    if (/white/.test(f)) return 'finish-white.png';
    return null;
  }
  // Swatches suit finishes, not sizes or tap-hole options. Where a product
  // repeats a finish (a valve in four finishes across three outlet counts),
  // show each finish once, pointing at its first option.
  function finishSwatches(p) {
    if (p.variants.length < 2) return null;
    var seen = {}, out = [];
    for (var i = 0; i < p.variants.length; i++) {
      var file = finishSwatch(p.variants[i].finish);
      if (!file) return null;                 // a size or fitting option, not a finish
      if (!seen[file]) {
        seen[file] = true;
        out.push({ file: file, index: i, name: p.variants[i].finish });
      }
    }
    return (out.length >= 2 && out.length <= 6) ? out : null;
  }

  // Do the variants actually differ visually? (drives the picker's thumbnails)
  function variantsDiffer(p) {
    var seen = {}, n = 0;
    p.variants.forEach(function (v) {
      var f = variantImage(p, v);
      if (f && !seen[f]) { seen[f] = 1; n++; }
    });
    return n > 1;
  }

  // Only water-using products carry the WRAS line.
  function isWaterUsing(cat, range, p) {
    if (['taps', 'thermostatic-valves', 'showering', 'wcs'].indexOf(cat.slug) !== -1) return true;
    if (cat.slug === 'concealed-cisterns-and-flush-plates') return range.slug === 'concealed-cisterns';
    if (cat.slug === 'wastes') return /filler/.test(p.slug) || /filler/i.test(p.name);
    return false;
  }
  function guaranteeLine(cat, range) {
    if (cat.slug === 'furniture-and-basins') {
      if (/basins|slabs|counter-top/.test(range.slug)) {
        return /slabs/.test(range.slug) ? 'Quality guaranteed' : '25 year guarantee when registered';
      }
      return '10 year guarantee when registered';
    }
    var map = {
      'wcs': '25 year guarantee when registered',
      'concealed-cisterns-and-flush-plates': '5 year guarantee when registered',
      'taps': '15 year guarantee when registered',
      'wastes': '15 year guarantee when registered',
      'thermostatic-valves': '15 year guarantee when registered',
      'showering': '15 year guarantee when registered'
    };
    if (cat.slug === 'accessories-and-mirrors') {
      return range.slug === 'scene'
        ? '5 year guarantee when registered (2 years on electrical components)'
        : '15 year guarantee when registered';
    }
    return map[cat.slug] || 'Quality guaranteed';
  }

  function crumbs(items) {
    return '<nav class="crumbs" aria-label="Breadcrumb">' + items.map(function (c, i) {
      return i === items.length - 1
        ? '<em>' + esc(c.label) + '</em>'
        : '<a href="' + u(c.href) + '">' + esc(c.label) + '</a><span class="sep">/</span>';
    }).join('') + '</nav>';
  }

  function addonBlock(addons) {
    if (!addons || !addons.length) return '';
    return '<div class="addons"><span class="eyebrow">Complete the look</span><h3 style="margin-top:12px">Why not add…</h3>' +
      '<div class="grid grid--2" style="margin-top:26px">' + addons.map(function (a) {
        return '<div class="addon-card">' +
          '<div class="pic"><img src="' + prodImg(a.image) + '" alt="' + esc(a.name) + '" loading="lazy"></div>' +
          '<div class="body"><h4>' + esc(a.name) + '</h4><ul>' +
          a.variants.map(function (v) {
            return '<li><span><span class="sku">' + esc(v.sku) + '</span>' + esc(v.finish) + '</span><span class="p">' + money(v.price) + '</span></li>';
          }).join('') + '</ul></div></div>';
      }).join('') + '</div></div>';
  }

  /* ---------- views ---------- */
  function productsIndex(cats) {
    document.title = 'Products — ARMERA';
    return crumbs([{ label: 'Home', href: '/' }, { label: 'Products' }]) +
      '<section class="pad--tight">' +
      '<span class="eyebrow">The collection</span>' +
      '<h1 style="max-width:16ch;margin:14px 0 18px">Products</h1>' +
      '<p class="lede" style="max-width:60ch">A complete and coordinated bathroomware portfolio — furniture, ceramics, brassware, showering and accessories, designed to work beautifully together.</p>' +
      '</section><section class="pad--tight"><div class="grid grid--2">' +
      cats.map(function (c) {
        return '<a class="tile" href="' + u('/products/' + c.slug + '/') + '">' +
          '<div class="frame"><img src="' + lifeImg(c.hero.img) + '" alt="' + esc(c.name) + '" loading="lazy"></div>' +
          '<div class="meta"><div class="name">' + esc(c.name) + '</div>' +
          '<div class="sub">' + c.ranges.map(function (r) { return esc(r.name); }).join(' · ') + '</div>' +
          '<span class="cue">View</span></div></a>';
      }).join('') + '</div></section>';
  }

  function categoryView(cat) {
    document.title = cat.name + ' — ARMERA';
    return crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name }]) +
      '<section class="pad--tight">' +
      '<span class="eyebrow">The collection</span>' +
      '<h1 style="margin:14px 0 0">' + esc(cat.name) + '</h1>' +
      '</section><section class="pad--tight"><div class="grid grid--3">' +
      cat.ranges.map(function (r) {
        return '<a class="tile" href="' + u('/products/' + cat.slug + '/' + r.slug + '/') + '">' +
          '<div class="frame"><img src="' + lifeImg(r.hero.img) + '" alt="' + esc(r.hero.caption || r.name) + '" loading="lazy"></div>' +
          '<div class="meta"><div class="name">' + esc(r.title) + '</div>' +
          '<div class="sub">' + esc(r.tagline) + '</div>' +
          '<span class="cue">View range</span></div></a>';
      }).join('') + '</div></section>';
  }

  function rangeView(cat, range) {
    document.title = range.title + ' — ' + cat.name + ' — ARMERA';
    var swatches = '';
    if (range.swatches && range.swatches.length) {
      swatches = '<div><span class="eyebrow" style="margin-bottom:16px">Colours</span><div class="swatches" style="margin-top:16px">' +
        range.swatches.map(function (s) {
          var chip = s.img ? '<div class="chip" style="background-image:url(\'' + swatchImg(s.img) + '\')"></div>' : '<div class="chip chip--plain"></div>';
          return '<div class="swatch">' + chip + '<p>' + esc(s.name) + '</p></div>';
        }).join('') + '</div></div>';
    } else if (range.features && range.features.length) {
      swatches = '<div><span class="eyebrow">In the detail</span><ul style="list-style:none;margin-top:16px">' +
        range.features.map(function (f) {
          return '<li style="padding:9px 0;border-bottom:1px solid var(--line);font-size:14.5px;color:var(--ink-soft)">' + esc(f) + '</li>';
        }).join('') + '</ul></div>';
    }

    return crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name, href: '/products/' + cat.slug + '/' }, { label: range.name }]) +
      '<figure class="range-hero"><img src="' + lifeImg(range.hero.img) + '" alt="' + esc(range.hero.caption || range.name) + '">' +
      (range.hero.caption ? '<figcaption>' + esc(range.hero.caption) + '</figcaption>' : '') + '</figure>' +
      '<section class="pad--tight"><div class="range-intro"><div>' +
      '<span class="eyebrow">' + esc(cat.name) + '</span>' +
      '<h1 style="margin:14px 0 18px">' + esc(range.title) + '</h1>' +
      '<p class="lede" style="max-width:48ch">' + esc(range.tagline) + '</p></div>' +
      '<div>' + swatches + '</div></div></section>' +
      '<section class="pad--tight"><div class="grid grid--3">' +
      range.products.map(function (p) {
        return '<a class="tile" href="' + u('/products/' + cat.slug + '/' + range.slug + '/' + p.slug + '/') + '">' +
          '<div class="frame cutout"><img src="' + prodImgSafe(mainImage(p)) + '" alt="' + esc(p.name) + '" loading="lazy"></div>' +
          '<div class="meta"><div class="name">' + esc(p.name) + '</div>' +
          (p.dims ? '<div class="sub">' + esc(p.dims) + (/x/.test(p.dims) ? ' mm' : '') + '</div>' : '') +
          '<div class="pricefrom">' + fromLabel(p) + ' <span class="small">RRP</span></div>' +
          '<span class="cue">View details</span></div></a>';
      }).join('') + '</div>' +
      (range.footnote ? '<p class="small" style="margin-top:38px;max-width:90ch">' + esc(range.footnote) + '</p>' : '') +
      addonBlock(range.addons) + '</section>';
  }

  function productView(cat, range, p) {
    document.title = p.name + ' — ' + range.title + ' — ARMERA';
    var hasColours = !!(range.swatches && range.swatches.length && p.variants[0].code);
    var heroImg = variantImage(p, p.variants[0]);

    // Round swatches: a range's own colours, or generic finish swatches
    var swatchButtons = '';
    if (!hasColours && variantsDiffer(p)) {
      var fs = finishSwatches(p);
      if (fs) {
        swatchButtons = '<div class="variant-swatches"><p class="label">Finish — <b>' + esc(p.variants[0].finish) + '</b></p><div class="row">' +
          fs.map(function (f, n) {
            return '<button type="button" class="' + (n === 0 ? 'on' : '') + '" style="background-image:url(\'' + swatchImg(f.file) + '\')" data-v="' + f.index + '" aria-label="' + esc(f.name) + '" title="' + esc(f.name) + '"></button>';
          }).join('') + '</div></div>';
      }
    }
    if (hasColours) {
      swatchButtons = '<div class="variant-swatches"><p class="label">Colour — <b>' + esc(p.variants[0].finish) + '</b></p><div class="row">' +
        p.variants.map(function (v, i) {
          var sw = (range.swatches || []).filter(function (x) { return x.code === v.code; })[0];
          var bg = sw && sw.img ? 'background-image:url(\'' + swatchImg(sw.img) + '\')' : 'background:#fff';
          return '<button type="button" class="' + (i === 0 ? 'on' : '') + '" style="' + bg + '" data-v="' + i + '" data-name="' + esc(v.finish) + '" aria-label="' + esc(v.finish) + '"></button>';
        }).join('') + '</div></div>';
    }

    // Pricing table, as before — every row clickable to preview that variation
    var finishCol = hasColours ? 'Colour' : 'Finish / option';
    var table = '<table class="pricing"><caption>Options &amp; pricing</caption>' +
      '<thead><tr><th>Code</th><th>' + finishCol + '</th><th class="price">RRP</th></tr></thead><tbody>' +
      p.variants.map(function (v, i) {
        return '<tr data-v="' + i + '"' + (i === 0 ? ' class="hl"' : '') + (v.code ? ' data-code="' + esc(v.code) + '"' : '') + '>' +
          '<td class="sku">' + esc(v.sku) + '</td><td>' + esc(v.finish) + '</td>' +
          '<td class="price">' + money(v.price) + '</td></tr>';
      }).join('') + '</tbody></table>';

    var gallery = '';
    if (p.gallery && p.gallery.length) {
      gallery = '<div class="thumbs"><button type="button" class="on" data-img="' + prodImgSafe(heroImg) + '"><img src="' + prodImgSafe(heroImg) + '" alt=""></button>' +
        p.gallery.map(function (g) {
          return '<button type="button" data-img="' + prodImg(g) + '"><img src="' + prodImg(g) + '" alt=""></button>';
        }).join('') + '</div>';
    }

    var notes = [p.note].concat(p.notes || []).filter(Boolean).map(function (n) {
      return '<p class="note">' + esc(n) + '</p>';
    }).join('');

    var basinNote = '';
    if (p.basinLink) {
      var basinName = p.basinLink === 'in-cabinet-ceramic-basins' ? 'in-cabinet ceramic basins' : 'Reef/Holloway ceramic basins';
      basinNote = '<p class="footnote">Pair with a ceramic basin from the <a href="' + u('/products/furniture-and-basins/' + p.basinLink + '/') + '" style="border-bottom:1px solid var(--line-dark)">' + basinName + '</a> range.</p>';
    }

    var assure = '<div class="assure"><span>' + esc(guaranteeLine(cat, range)) + '</span>' +
      (isWaterUsing(cat, range, p) ? '<span>WRAS compliant</span>' : '') +
      '<span>Available through ARMERA retail partners</span></div>';

    var related = range.products.filter(function (x) { return x.slug !== p.slug; }).slice(0, 4);
    var relatedHtml = related.length ? '<section class="pad--tight"><div class="section-head"><div>' +
      '<span class="eyebrow">More from this range</span>' +
      '<h2 style="font-size:clamp(24px,2.6vw,34px)">' + esc(range.title) + '</h2></div>' +
      '<a class="more" href="' + u('/products/' + cat.slug + '/' + range.slug + '/') + '">View all</a></div>' +
      '<div class="grid grid--4">' + related.map(function (x) {
        return '<a class="tile" href="' + u('/products/' + cat.slug + '/' + range.slug + '/' + x.slug + '/') + '">' +
          '<div class="frame cutout"><img src="' + prodImgSafe(mainImage(x)) + '" alt="' + esc(x.name) + '" loading="lazy"></div>' +
          '<div class="meta"><div class="name" style="font-size:16px">' + esc(x.name) + '</div>' +
          '<div class="pricefrom">' + fromLabel(x) + '</div></div></a>';
      }).join('') + '</div></section>' : '';

    return crumbs([{ label: 'Home', href: '/' }, { label: 'Products', href: '/products/' }, { label: cat.name, href: '/products/' + cat.slug + '/' }, { label: range.name, href: '/products/' + cat.slug + '/' + range.slug + '/' }, { label: p.name }]) +
      '<section class="pad--tight"><div class="pdp">' +
      '<div class="stage"><div class="inner"><img src="' + prodImgSafe(heroImg) + '" alt="' + esc(range.name) + ' ' + esc(p.name) + '"></div>' + gallery + '</div>' +
      '<div class="info"><span class="eyebrow">' + esc(range.title) + '</span>' +
      '<h1>' + esc(p.name) + '</h1>' +
      (p.dims ? '<p class="dims">' + esc(p.dims) + (/x/.test(p.dims) ? ' mm' : '') + '</p>' : '') +
      '<p class="from">' + fromLabel(p) + '<span class="inc">RRP inc. VAT</span></p>' +
      swatchButtons + table + notes + basinNote +
      '<div id="product-docs"></div>' +
      (p.footnote ? '<p class="footnote">' + esc(p.footnote) + '</p>' : '') +
      assure + '</div></div>' +
      '<div id="product-pairs"></div>' +
      addonBlock(range.addons) +
      (range.footnote ? '<p class="small" style="margin-top:30px;max-width:90ch">' + esc(range.footnote) + '</p>' : '') +
      '</section>' + relatedHtml;
  }

  // Documents, photo-gallery shots and hand-picked pairings for this product.
  function loadProductDocs(cats, segs, p) {
    var holder = root.querySelector('#product-docs');
    var key = segs[1] + '/' + segs[2] + '/' + p.slug;
    var title = function (n) {
      return n.replace(/\.pdf$/i, '').replace(/^\s*\d+[\s._-]+/, '').replace(/_+/g, ' ').trim();
    };
    var docRow = function (url, label, kind) {
      return '<a class="doc-link" href="' + esc(url) + '" target="_blank" rel="noopener">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>' +
        '<span>' + esc(label) + '</span><span class="kind">' + esc(kind) + '</span></a>';
    };

    // Documents that come straight from the product record
    var docs = [];
    if (p.spec) docs.push(docRow(cfg.assets + '/spec-sheets/' + encodeURIComponent(p.spec), 'Specification sheet', 'PDF'));
    if (p.drawing) docs.push(docRow(cfg.assets + '/drawings/' + encodeURIComponent(p.drawing), 'Dimensional drawing', 'PDF'));

    function paint() {
      if (!holder) return;
      holder.innerHTML = docs.length
        ? '<div class="prod-docs"><p class="label">Downloads</p>' + docs.join('') + '</div>'
        : '';
    }
    paint();

    fetch(cfg.supabaseUrl + '/rest/v1/site_content?key=in.(instruction_links,gallery)&select=key,data', {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
    }).then(function (r) { return r.json(); }).then(function (rows) {
      rows = rows || [];
      var links = (rows.filter(function (r) { return r.key === 'instruction_links'; })[0] || {}).data || {};
      var gallery = (rows.filter(function (r) { return r.key === 'gallery'; })[0] || {}).data || [];

      Object.keys(links).filter(function (f) {
        return (links[f] || []).indexOf(key) !== -1;
      }).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); })
        .forEach(function (f) {
          docs.push(docRow(cfg.supabaseUrl + '/storage/v1/object/public/' + cfg.instructionsBucket + '/' + encodeURIComponent(f), title(f), 'Instructions'));
        });
      paint();

      // Photo-gallery shots tagged with this product join the image strip
      var shots = (Array.isArray(gallery) ? gallery : []).filter(function (g) {
        return g && g.file && (g.products || []).indexOf(key) !== -1;
      });
      if (shots.length) addGalleryStrip(p, shots);
    }).catch(function () {});

    // Hand-picked pairings chosen in the admin
    if (p.goesWith && p.goesWith.length) renderPairs(cats, p);
  }

  function addGalleryStrip(p, shots) {
    var stage = root.querySelector('.pdp .stage');
    var stageImg = root.querySelector('.pdp .stage .inner img');
    if (!stage || !stageImg) return;
    var productSrc = stageImg.src;
    var strip = document.createElement('div');
    strip.className = 'gallery-strip';

    var mk = function (src, isLifestyle, label) {
      var b = document.createElement('button');
      b.type = 'button';
      b.title = label || '';
      var im = document.createElement('img');
      im.src = src; im.alt = label || '';
      im.loading = 'lazy';
      b.appendChild(im);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(strip.children, function (c) { c.classList.remove('on'); });
        b.classList.add('on');
        stageImg.src = src;
        stageImg.classList.toggle('lifestyle', !!isLifestyle);
      });
      return b;
    };
    var first = mk(productSrc, false, 'Product photograph');
    first.classList.add('on');
    strip.appendChild(first);
    shots.forEach(function (g) {
      strip.appendChild(mk(cfg.assets + '/gallery/' + encodeURIComponent(g.file), true, g.caption || 'In a bathroom'));
    });
    stage.appendChild(strip);
  }

  function renderPairs(cats, p) {
    var holder = root.querySelector('#product-pairs');
    if (!holder) return;
    var byKey = {};
    cats.forEach(function (c) {
      (c.ranges || []).forEach(function (rg) {
        (rg.products || []).forEach(function (x) {
          byKey[c.slug + '/' + rg.slug + '/' + x.slug] = { cat: c, rng: rg, p: x };
        });
      });
    });
    var picks = p.goesWith.map(function (k) { return byKey[k]; }).filter(Boolean);
    if (!picks.length) return;
    holder.innerHTML = '<div class="pairs"><span class="eyebrow">Coordinated</span>' +
      '<h3 style="margin-top:12px">Looks good with…</h3>' +
      '<p class="sub">Pieces chosen to sit beautifully alongside this one.</p>' +
      '<div class="grid grid--4">' + picks.map(function (o) {
        return '<a class="tile" href="' + u('/products/' + o.cat.slug + '/' + o.rng.slug + '/' + o.p.slug + '/') + '">' +
          '<div class="frame cutout"><img src="' + prodImgSafe(mainImage(o.p)) + '" alt="' + esc(o.p.name) + '" loading="lazy"></div>' +
          '<div class="meta"><div class="name" style="font-size:16px">' + esc(o.p.name) + '</div>' +
          '<div class="sub">' + esc(o.rng.title) + '</div>' +
          '<div class="pricefrom">' + fromLabel(o.p) + '</div></div></a>';
      }).join('') + '</div></div>';
  }

  function notFound() {
    document.title = 'Page not found — ARMERA';
    return '<section class="pad"><span class="eyebrow">ARMERA</span>' +
      '<h1 style="margin:14px 0 18px">Page not found</h1>' +
      '<p class="lede" style="max-width:50ch">The page you are looking for is no longer here. Browse the collection instead.</p>' +
      '<a class="btn" href="' + u('/products/') + '">Explore the collection</a></section>';
  }

  function bind(p) {
    var stageImg = root.querySelector('.pdp .stage .inner img');
    if (!stageImg || !p) return;

    function selectVariant(i) {
      var v = p.variants[i];
      if (!v) return;
      var src = prodImgSafe(variantImage(p, v));
      var pre = new Image();
      pre.onload = function () { stageImg.src = src; };
      pre.src = src;
      Array.prototype.forEach.call(root.querySelectorAll('.variant-swatches button'), function (b) {
        b.classList.toggle('on', +b.getAttribute('data-v') === i);
      });
      Array.prototype.forEach.call(root.querySelectorAll('table.pricing tbody tr'), function (tr) {
        tr.classList.toggle('hl', +tr.getAttribute('data-v') === i);
      });
      var label = root.querySelector('.variant-swatches .label b');
      if (label) label.textContent = v.finish;
    }

    Array.prototype.forEach.call(root.querySelectorAll('.variant-swatches button, table.pricing tbody tr'), function (btn) {
      btn.addEventListener('click', function () { selectVariant(+btn.getAttribute('data-v')); });
    });

    var thumbs = root.querySelectorAll('.pdp .thumbs button');
    Array.prototype.forEach.call(thumbs, function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(thumbs, function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        stageImg.src = btn.getAttribute('data-img');
      });
    });
  }

  /* ---------- route + render ---------- */
  fetch(cfg.supabaseUrl + '/rest/v1/site_content?select=key,data&order=key', {
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
  }).then(function (r) { return r.json(); }).then(function (rows) {
    var cats = rows.filter(function (r) { return /^\d\d-/.test(r.key); }).map(function (r) { return r.data; });
    if (!cats.length) { root.innerHTML = notFound(); return; }

    var path = location.pathname;
    if (cfg.base && path.indexOf(cfg.base) === 0) path = path.slice(cfg.base.length);
    var segs = path.replace(/\/+$/, '').split('/').filter(Boolean); // e.g. ['products','taps','aeres','slug']

    var html, bound = null, catSeen = null, rangeSeen = null;
    if (segs[0] !== 'products') {
      html = notFound();
    } else if (segs.length === 1) {
      html = productsIndex(cats);
    } else {
      var cat = cats.filter(function (c) { return c.slug === segs[1]; })[0];
      catSeen = cat || null;
      if (!cat) html = notFound();
      else if (segs.length === 2) html = categoryView(cat);
      else {
        var range = cat.ranges.filter(function (r) { return r.slug === segs[2]; })[0];
        rangeSeen = range || null;
        if (!range) html = notFound();
        else if (segs.length === 3) html = rangeView(cat, range);
        else {
          var p = range.products.filter(function (x) { return x.slug === segs[3]; })[0];
          html = p ? productView(cat, range, p) : notFound();
          bound = p || null;
        }
      }
    }
    root.innerHTML = html;
    bind(bound);
    if (bound) loadProductDocs(cats, segs, bound);
    if (window.armeraTrack) {
      if (bound) window.armeraTrack({ page_type: 'product', item_ref: bound.slug, item_name: bound.name });
      else if (segs.length === 3) window.armeraTrack({ page_type: 'range', item_ref: segs[2], item_name: (rangeSeen && rangeSeen.title) || segs[2] });
      else if (segs.length === 2) window.armeraTrack({ page_type: 'category', item_ref: segs[1], item_name: (catSeen && catSeen.name) || segs[1] });
      else window.armeraTrack();
    }
  }).catch(function () {
    root.innerHTML = '<section class="pad--tight"><p class="small">The collection could not be loaded. Please refresh, or call 01225 251204.</p></section>';
  });
})();
