// Find a retailer — map + searchable list, rendered from the Supabase
// site_content 'retailers' row (managed in the admin area).
// Every retailer stays pinned on the map at all times; searching moves and
// zooms the map to the place typed in and draws the chosen search radius.
(function () {
  var cfg = window.ARMERA;
  var mapEl = document.getElementById('retailer-map');
  var listEl = document.getElementById('retailer-list');
  if (!mapEl || !listEl || !cfg) return;

  var countEl = document.getElementById('retailer-count');
  var searchEl = document.getElementById('retailer-search');
  var radiusEl = document.getElementById('retailer-radius');
  var clearEl = document.getElementById('retailer-clear');
  var emptyEl = document.getElementById('retailer-empty');

  var all = [];            // every retailer, each tagged with a stable index _i
  var shown = [];          // what the list is currently showing
  var byIndex = {};        // _i -> leaflet marker
  var map = null, layer = null, circle = null, centreMark = null, active = null;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function tidyUrl(u) {
    return String(u || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  function fullAddress(r) {
    return [r.address, r.town, r.county, r.postcode].filter(Boolean).join(', ');
  }
  function milesBetween(aLat, aLng, bLat, bLng) {
    var R = 3958.8, p = Math.PI / 180;
    var dLat = (bLat - aLat) * p, dLng = (bLng - aLng) * p;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function radiusMiles() { return parseInt(radiusEl.value, 10) || 30; }

  /* ---------- map ---------- */
  function armeraPin(isActive) {
    return L.divIcon({
      className: 'armera-pin-wrap',
      html: '<span class="armera-pin' + (isActive ? ' on' : '') + '">' +
            '<img src="' + cfg.assets + '/brand/mark-a-light.png" alt=""></span>',
      iconSize: [34, 44],
      iconAnchor: [17, 44],
      popupAnchor: [0, -40]
    });
  }

  function popupHtml(r) {
    var lines = [];
    lines.push('<strong>' + esc(r.name) + '</strong>');
    lines.push('<span class="addr">' + esc(fullAddress(r)) + '</span>');
    if (r.phone) lines.push('<a href="tel:' + esc(r.phone.replace(/\s+/g, '')) + '">' + esc(r.phone) + '</a>');
    if (r.website) lines.push('<a href="' + esc(r.website) + '" target="_blank" rel="noopener">' + esc(tidyUrl(r.website)) + '</a>');
    lines.push('<a href="https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(fullAddress(r)) + '" target="_blank" rel="noopener">Directions</a>');
    return '<div class="retailer-popup">' + lines.join('') + '</div>';
  }

  function buildMap() {
    map = L.map(mapEl, { scrollWheelZoom: false, zoomControl: true })
      .setView([54.2, -3.0], 6);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(map);
    layer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyDistanceMultiplier: 1.4,
      maxClusterRadius: 54,
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount();
        var size = n < 10 ? 40 : n < 50 ? 48 : 56;
        return L.divIcon({
          className: 'armera-cluster-wrap',
          html: '<span class="armera-cluster" style="width:' + size + 'px;height:' + size + 'px">' + n + '</span>',
          iconSize: [size, size]
        });
      }
    }).addTo(map);
    map.on('click', function () { setActive(null); });
  }

  // Drawn once — every retailer stays on the map for the whole session.
  function drawAllMarkers() {
    layer.clearLayers();
    byIndex = {};
    all.forEach(function (r) {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
      var m = L.marker([r.lat, r.lng], { icon: armeraPin(false), title: r.name })
        .bindPopup(popupHtml(r), { closeButton: true, maxWidth: 280 });
      m.on('click', function () { setActive(r._i, true); });
      layer.addLayer(m);
      byIndex[r._i] = m;
    });
  }

  function clearCircle() {
    if (circle) { map.removeLayer(circle); circle = null; }
    if (centreMark) { map.removeLayer(centreMark); centreMark = null; }
  }

  // Centre and zoom tight on the place typed in, showing the chosen radius.
  function focusArea(pt, miles) {
    clearCircle();
    circle = L.circle([pt.lat, pt.lng], {
      radius: miles * 1609.34,
      className: 'radius-ring',
      color: '#232220', weight: 1, opacity: .55,
      fillColor: '#232220', fillOpacity: .05,
      interactive: false
    }).addTo(map);
    centreMark = L.circleMarker([pt.lat, pt.lng], {
      radius: 5, color: '#232220', weight: 2, opacity: .9,
      fillColor: '#f6f3ec', fillOpacity: 1, interactive: false
    }).addTo(map);
    // fitBounds on the circle zooms exactly to the searched area
    map.fitBounds(circle.getBounds(), { padding: [24, 24], animate: true });
  }

  function resetView() {
    clearCircle();
    var pts = Object.keys(byIndex).map(function (k) { return byIndex[k].getLatLng(); });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }

  function setActive(idx, fromMap) {
    active = idx;
    Array.prototype.forEach.call(listEl.children, function (card) {
      card.classList.toggle('on', card.dataset && +card.dataset.i === idx);
    });
    Object.keys(byIndex).forEach(function (k) {
      byIndex[k].setIcon(armeraPin(+k === idx));
    });
    var m = byIndex[idx];
    if (m && !fromMap) {
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
      if (layer.zoomToShowLayer) layer.zoomToShowLayer(m, function () { m.openPopup(); });
      else m.openPopup();
    }
    if (idx != null && !fromMap) {
      var card = listEl.querySelector('[data-i="' + idx + '"]');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------- list ---------- */
  function drawList(summary) {
    listEl.innerHTML = '';
    shown.forEach(function (r) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'retailer-card';
      card.dataset.i = r._i;
      var bits = '<span class="rname">' + esc(r.name) + '</span>' +
        '<span class="raddr">' + esc(fullAddress(r)) + '</span>';
      if (r._distance != null) bits += '<span class="rdist">' + r._distance.toFixed(1) + ' miles away</span>';
      var links = '';
      if (r.phone) links += '<a href="tel:' + esc(r.phone.replace(/\s+/g, '')) + '" class="rlink">' + esc(r.phone) + '</a>';
      if (r.website) links += '<a href="' + esc(r.website) + '" target="_blank" rel="noopener" class="rlink">' + esc(tidyUrl(r.website)) + '</a>';
      if (links) bits += '<span class="rlinks">' + links + '</span>';
      card.innerHTML = bits;
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('rlink')) return; // let phone/website links work
        setActive(+card.dataset.i);
      });
      listEl.appendChild(card);
    });
    countEl.textContent = summary || (shown.length + (shown.length === 1 ? ' retailer' : ' retailers'));
    emptyEl.style.display = shown.length ? 'none' : 'block';
  }

  /* ---------- search ---------- */
  // Resolve a UK postcode, outward code or place name via postcodes.io.
  function resolvePlace(q) {
    q = String(q || '').trim();
    if (!q) return Promise.resolve(null);
    var asPostcode = fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === 200 && j.result) {
          return { lat: j.result.latitude, lng: j.result.longitude, label: j.result.postcode };
        }
        return null;
      }).catch(function () { return null; });

    return asPostcode.then(function (hit) {
      if (hit) return hit;
      var out = q.split(/\s+/)[0];
      return fetch('https://api.postcodes.io/outcodes/' + encodeURIComponent(out))
        .then(function (r) { return r.json(); })
        .then(function (o) {
          if (o.status === 200 && o.result) {
            return { lat: o.result.latitude, lng: o.result.longitude, label: o.result.outcode };
          }
          return null;
        }).catch(function () { return null; });
    }).then(function (hit) {
      if (hit) return hit;
      return fetch('https://api.postcodes.io/places?q=' + encodeURIComponent(q) + '&limit=1')
        .then(function (r) { return r.json(); })
        .then(function (p) {
          var res = p && p.result && p.result[0];
          if (!res) return null;
          return { lat: res.latitude, lng: res.longitude, label: res.name_1 };
        }).catch(function () { return null; });
    });
  }

  function showAll() {
    all.forEach(function (r) { r._distance = null; });
    shown = all.slice();
    clearEl.style.display = 'none';
    drawList();
    resetView();
    setActive(null);
  }

  function textFilter(q) {
    var needle = q.toLowerCase();
    all.forEach(function (r) { r._distance = null; });
    shown = all.filter(function (r) {
      return (r.name + ' ' + fullAddress(r)).toLowerCase().indexOf(needle) !== -1;
    });
    clearEl.style.display = 'inline-block';
    clearCircle();
    drawList(shown.length + ' matching');
    var pts = shown.map(function (r) { return byIndex[r._i] && byIndex[r._i].getLatLng(); }).filter(Boolean);
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
    setActive(null);
  }

  function doSearch() {
    var q = searchEl.value.trim();
    if (!q) return showAll();
    var miles = radiusMiles();
    searchEl.disabled = true;
    resolvePlace(q).then(function (pt) {
      searchEl.disabled = false;
      if (!pt) return textFilter(q);

      all.forEach(function (r) { r._distance = milesBetween(pt.lat, pt.lng, r.lat, r.lng); });
      shown = all.filter(function (r) { return r._distance <= miles; })
                 .sort(function (a, b) { return a._distance - b._distance; });

      clearEl.style.display = 'inline-block';
      drawList(shown.length + ' within ' + miles + ' miles of ' + pt.label);
      focusArea(pt, miles);   // zoom right in on the area typed in
      setActive(null);
    });
  }

  /* ---------- boot ---------- */
  function addCss(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadLeaflet() {
    addCss(cfg.assets + '/vendor/leaflet/leaflet.css');
    addCss(cfg.assets + '/vendor/leaflet/markercluster.css');
    return addScript(cfg.assets + '/vendor/leaflet/leaflet.js')
      .then(function () { return addScript(cfg.assets + '/vendor/leaflet/markercluster.js'); });
  }

  Promise.all([
    fetch(cfg.supabaseUrl + '/rest/v1/site_content?key=eq.retailers&select=data', {
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
    }).then(function (r) { return r.json(); }),
    loadLeaflet()
  ]).then(function (res) {
    var rows = res[0];
    all = ((rows && rows[0] && rows[0].data) || []).filter(function (r) { return r && r.name; });
    all.forEach(function (r, i) { r._i = i; });
    if (!all.length) {
      mapEl.style.display = 'none';
      emptyEl.style.display = 'block';
      countEl.textContent = '';
      return;
    }
    buildMap();
    drawAllMarkers();
    showAll();

    searchEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });
    document.getElementById('retailer-go').addEventListener('click', doSearch);
    radiusEl.addEventListener('change', function () {
      if (searchEl.value.trim()) doSearch();
    });
    clearEl.addEventListener('click', function () {
      searchEl.value = '';
      showAll();
      searchEl.focus();
    });
  }).catch(function () {
    mapEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'The retailer list could not be loaded. Please call 01225 251204 and we will point you to your nearest stockist.';
  });
})();
