// Order a colour swatch.
// The colours come from the live catalogue — every range that has colour
// swatches with a picture — so a colour added in the admin can be ordered
// without anyone touching this page.
(function () {
  var cfg = window.ARMERA;
  var form = document.getElementById('swatch-form');
  if (!cfg || !form) return;

  var host = document.getElementById('sw-choices');
  var countEl = document.getElementById('sw-count');
  var msg = document.getElementById('sw-msg');
  var send = document.getElementById('sw-send');
  var MAX = 12;

  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  var filePath = function (f) { return String(f).split('/').map(encodeURIComponent).join('/'); };

  // each colour once, however many ranges it was ticked under
  function picked() {
    var seen = {};
    return Array.prototype.filter.call(form.querySelectorAll('.sw-pick input:checked'), function (i) {
      var k = i.getAttribute('data-colour');
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }
  function tally() {
    var n = picked().length;
    countEl.textContent = n ? n + (n === 1 ? ' colour chosen' : ' colours chosen') + (n >= MAX ? ' — that is the most we can send at once.' : '') : '';
    Array.prototype.forEach.call(form.querySelectorAll('.sw-pick input'), function (i) {
      i.disabled = !i.checked && n >= MAX;
    });
  }

  var wanted = '';
  try { wanted = new URLSearchParams(location.search).get('range') || ''; } catch (e) {}

  // Colours are grouped under each range. A colour offered in several ranges
  // (Potter's clay is in four) is the same sample, so it shows the same
  // picture everywhere, and ticking it in one range ticks it in the others.
  function collect(rows) {
    var pic = {}, ranges = [];
    var keyOf = function (s) { return (s.code ? String(s.code) : '') + '|' + String(s.name).toLowerCase(); };
    (rows || []).filter(function (r) { return /^\d\d-/.test(r.key) && r.data && r.data.slug === 'furniture-and-basins'; })
      .forEach(function (row) {
        (row.data.ranges || []).forEach(function (rg) {
          var list = [];
          (rg.swatches || []).forEach(function (s) {
            if (!s || !s.name) return;
            var k = keyOf(s);
            if (!pic[k] && s.img) pic[k] = s.img;     // the first picture of a colour is used everywhere
            list.push({ key: k, code: s.code || '', name: s.name });
          });
          if (list.length) ranges.push({ slug: rg.slug, name: rg.name, colours: list });
        });
      });
    ranges.forEach(function (rg) {
      rg.colours = rg.colours.filter(function (c) { c.img = pic[c.key]; return c.img; });
    });
    return ranges.filter(function (rg) { return rg.colours.length; });
  }

  function choice(c) {
    var lab = el('label', 'sw-pick');
    var box = document.createElement('input');
    box.type = 'checkbox';
    box.value = JSON.stringify({ code: c.code, name: c.name });
    box.setAttribute('data-colour', c.key);
    box.addEventListener('change', function () {
      // the same colour under another range is the same sample
      Array.prototype.forEach.call(form.querySelectorAll('.sw-pick input'), function (o) {
        if (o !== box && o.getAttribute('data-colour') === c.key) o.checked = box.checked;
      });
      tally();
    });
    var chip = el('span', 'sw-chip');
    var im = document.createElement('img');
    im.src = cfg.assets + '/swatches/' + filePath(c.img);
    im.alt = '';
    im.loading = 'lazy';
    chip.appendChild(im);
    lab.appendChild(box);
    lab.appendChild(chip);
    lab.appendChild(el('span', 'sw-name', c.name));
    return lab;
  }

  fetch(cfg.dataUrl + '/rest/v1/site_content?select=key,data&order=key')
    .then(function (r) { return r.json(); }).then(function (rows) {
      host.textContent = '';
      var ranges = collect(rows);
      if (!ranges.length) {
        host.appendChild(el('p', 'small', 'There are no colour swatches to order at the moment. Please call 01225 251204.'));
        return;
      }
      // arriving from a range page, that range comes first
      ranges.sort(function (x, y) { return (y.slug === wanted) - (x.slug === wanted); });
      ranges.forEach(function (rg) {
        var g = el('div', 'sw-range');
        g.appendChild(el('p', 'sw-range-name', rg.name));
        var grid = el('div', 'sw-grid');
        rg.colours.forEach(function (c) { grid.appendChild(choice(c)); });
        g.appendChild(grid);
        host.appendChild(g);
      });
    }).catch(function () {
      host.textContent = '';
      host.appendChild(el('p', 'small', 'The colours could not be loaded. Please refresh, or call 01225 251204.'));
    });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'small';
    var chosen = Array.prototype.map.call(picked(), function (i) { return JSON.parse(i.value); });
    var missing = [];
    Array.prototype.forEach.call(form.querySelectorAll('[required]'), function (f) {
      var ok = f.value && f.value.trim();
      if (f.type === 'email') ok = ok && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.value.trim());
      f.classList.toggle('gf-invalid', !ok);
      if (!ok) missing.push(f);
    });
    if (!chosen.length) {
      msg.textContent = 'Please choose at least one colour.';
      msg.className = 'small gf-error';
      host.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (missing.length) {
      msg.textContent = 'Please complete the highlighted fields.';
      msg.className = 'small gf-error';
      missing[0].focus();
      return;
    }
    var val = function (n) {
      var f = form.querySelector('[name="' + n + '"]');
      return f && f.value ? f.value.trim() : null;
    };
    send.disabled = true;
    msg.textContent = 'Sending…';
    fetch(cfg.dataUrl + '/swatch-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: val('name'), company: val('company'), email: val('email'), phone: val('phone'),
        address1: val('address1'), address2: val('address2'), town: val('town'), postcode: val('postcode'),
        notes: val('notes'), swatches: chosen, website: val('website')
      })
    }).then(function (r) {
      send.disabled = false;
      if (r.ok) {
        form.textContent = '';
        var done = el('div', 'gf-done');
        done.appendChild(el('span', 'eyebrow', 'Thank you'));
        var h = el('h2', null, 'Your request is with us');
        h.style.margin = '12px 0 14px';
        done.appendChild(h);
        done.appendChild(el('p', null, 'We have your details and the colours you chose, and will post your samples to the address you gave.'));
        var a = el('a', 'btn', 'Back to the collection');
        a.href = (cfg.base || '') + '/products/';
        done.appendChild(a);
        form.appendChild(done);
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
        return;
      }
      return r.json().catch(function () { return {}; }).then(function (res) {
        msg.className = 'small gf-error';
        msg.textContent = r.status === 429
          ? 'Too many requests just now. Please wait a minute and try again.'
          : (res.error || 'We could not save your request.') + ' You can also call 01225 251204 or email sales@armera.co.uk.';
      });
    }).catch(function () {
      send.disabled = false;
      msg.className = 'small gf-error';
      msg.textContent = 'We could not reach the server. Please check your connection and try again.';
    });
  });
})();
