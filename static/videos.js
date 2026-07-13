// Renders the how-to videos from the Supabase site_content 'videos' row.
// Managed in the admin area; each card links out to YouTube.
(function () {
  var cfg = window.ARMERA;
  var grid = document.getElementById('video-grid');
  var empty = document.getElementById('video-empty');
  if (!grid || !cfg) return;

  fetch(cfg.supabaseUrl + '/rest/v1/site_content?key=eq.videos&select=data', {
    headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey }
  }).then(function (r) { return r.json(); }).then(function (rows) {
    var videos = (rows && rows[0] && rows[0].data) || [];
    if (!Array.isArray(videos) || !videos.length) {
      empty.style.display = 'block';
      return;
    }
    videos.forEach(function (v) {
      var a = document.createElement('a');
      a.className = 'video-card';
      a.href = v.url;
      a.target = '_blank';
      a.rel = 'noopener';
      var img = document.createElement('img');
      img.src = cfg.assets + '/videos/' + encodeURIComponent(v.thumb || '');
      img.alt = v.title || 'ARMERA how-to video';
      img.loading = 'lazy';
      var shade = document.createElement('div');
      shade.className = 'shade';
      var h4 = document.createElement('h4');
      h4.textContent = v.title || '';
      var play = document.createElement('span');
      play.className = 'play';
      a.appendChild(img);
      a.appendChild(shade);
      a.appendChild(h4);
      a.appendChild(play);
      grid.appendChild(a);
    });
  }).catch(function () {
    empty.style.display = 'block';
  });
})();
