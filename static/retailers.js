// Find a retailer — map + searchable list, rendered from the Supabase
// site_content 'retailers' row (managed in the admin area).
(function () {
  var cfg = window.ARMERA;
  var mapEl = document.getElementById('retailer-map');
  var listEl = document.getElementById('retailer-list');
  if (!mapEl || !listEl || !cfg) return;

  var countEl = document.getElementById('retailer-count');
  var searchEl = document.getElementById('retailer-search');
  var clearEl = document.getElementById('retailer-clear');
  var emptyEl = document.getElementById('retailer-empty');

  var all = [], shown = [], markers = [], map = null, layer = null, active = null;

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
  function haversine(a, b, c, d) {
    var R = 3958.8, p = Math.PI / 180;
    var dLat = (c - a) * p, dLng = (d - b) * p;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a * p) * Math.cos(c * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

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

  function drawMarkers() {
    layer.clearLayers();
    markers = [];
    shown.forEach(function (r, i) {
      if (typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
      var m = L.marker([r.lat, r.lng], { icon: armeraPin(false), title: r.name })
        .bindPopup(popupHtml(r), { closeButton: true, maxWidth: 280 });
      m.on('click', function () { setActive(i, true); });
      layer.addLayer(m);
      markers.push({ idx: i, marker: m });
    });
    fitToMarkers();
  }

  function fitToMarkers() {
    if (!markers.length) return;
    var pts = markers.map(function (m) { return m.marker.getLatLng(); });
    if (pts.length === 1) map.setView(pts[0], 12);
    else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }

  function setActive(i, fromMap) {
    active = i;
    Array.prototype.forEach.call(listEl.children, function (card, n) {
      card.classList.toggle('on', n === i);
    });
    markers.forEach(function (m) {
      m.marker.setIcon(armeraPin(m.idx === i));
      if (m.idx === i && !fromMap) {
        map.setView(m.marker.getLatLng(), Math.max(map.getZoom(), 12), { animate: true });
        if (layer.zoomToShowLayer) layer.zoomToShowLayer(m.marker, function () { m.marker.openPopup(); });
        else m.marker.openPopup();
      }
    });
    if (i !== null && !fromMap) {
      var card = listEl.children[i];
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------- list ---------- */
  function drawList() {
    listEl.innerHTML = '';
    shown.forEach(function (r, i) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'retailer-card';
      var bits = '<span class="rname">' + esc(r.name) + '</span>' +
        '<span class="raddr">' + esc(fullAddress(r)) + '</span>';
      if (r.distance != null) bits += '<span class="rdist">' + r.distance.toFixed(1) + ' miles away</span>';
      var links = '';
      if (r.phone) links += '<a href="tel:' + esc(r.phone.replace(/\s+/g, '')) + '" class="rlink">' + esc(r.phone) + '</a>';
      if (r.website) links += '<a href="' + esc(r.website) + '" target="_blank" rel="noopener" class="rlink">' + esc(tidyUrl(r.website)) + '</a>';
      if (links) bits += '<span class="rlinks">' + links + '</span>';
      card.innerHTML = bits;
      card.addEventListener('click', function (e) {
        if (e.target.classList.contains('rlink')) return; // let phone/website links work
        setActive(i);
      });
      listEl.appendChild(card);
    });
    countEl.textContent = shown.length + (shown.length === 1 ? ' retailer' : ' retailers');
    emptyEl.style.display = shown.length ? 'none' : 'block';
  }

  /* ---------- search ---------- */
  function applySearch(q) {
    q = (q || '').trim().toLowerCase();
    if (!q) {
      shown = all.slice();
      shown.forEach(function (r) { r.distance = null; });
      clearEl.style.display = 'none';
    } else {
      clearEl.style.display = 'inline-block';
      var terms = q.replace(/\s+/g, ' ');
      shown = all.filter(function (r) {
        return (r.name + ' ' + fullAddress(r)).toLowerCase().indexOf(terms) !== -1;
      });
      shown.forEach(function (r) { r.distance = null; });
    }
    drawList();
    drawMarkers();
    setActive(null);
  }

  function searchByPostcode(q) {
    // UK postcode (full or outward) → centre the map and sort by distance
    return fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === 200 && j.result) return { lat: j.result.latitude, lng: j.result.longitude };
        return fetch('https://api.postcodes.io/outcodes/' + encodeURIComponent(q.split(' ')[0]))
          .then(function (r) { return r.json(); })
          .then(function (o) {
            if (o.status === 200 && o.result) return { lat: o.result.latitude, lng: o.result.longitude };
            return null;
          });
      }).catch(function () { return null; });
  }

  function doSearch() {
    var q = searchEl.value.trim();
    if (!q) return applySearch('');
    var looksPostcode = /^[A-Za-z]{1,2}\d[A-Za-z\d]?(\s*\d[A-Za-z]{2})?$/.test(q);
    if (!looksPostcode) return applySearch(q);
    searchEl.disabled = true;
    searchByPostcode(q).then(function (pt) {
      searchEl.disabled = false;
      searchEl.focus();
      if (!pt) return applySearch(q);
      shown = all.map(function (r) {
        var c = Object.create(r);
        c.distance = haversine(pt.lat, pt.lng, r.lat, r.lng);
        return c;
      }).filter(function (r) { return r.distance <= 100; })
        .sort(function (a, b) { return a.distance - b.distance; });
      clearEl.style.display = 'inline-block';
      drawList();
      drawMarkers();
      if (shown.length) {
        var pts = markers.slice(0, 8).map(function (m) { return m.marker.getLatLng(); });
        pts.push(L.latLng(pt.lat, pt.lng));
        map.fitBounds(L.latLngBounds(pts).pad(0.15));
      } else {
        map.setView([pt.lat, pt.lng], 9);
      }
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
    all = (rows && rows[0] && rows[0].data) || [];
    all = all.filter(function (r) { return r && r.name; });
    if (!all.length) {
      mapEl.style.display = 'none';
      emptyEl.style.display = 'block';
      countEl.textContent = '';
      return;
    }
    buildMap();
    applySearch('');
    searchEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
    document.getElementById('retailer-go').addEventListener('click', doSearch);
    clearEl.addEventListener('click', function () { searchEl.value = ''; applySearch(''); searchEl.focus(); });
  }).catch(function () {
    mapEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyEl.textContent = 'The retailer list could not be loaded. Please call 01225 251204 and we will point you to your nearest stockist.';
  });
})();
