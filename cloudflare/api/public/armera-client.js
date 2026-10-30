// A stand-in for the Supabase client the admin was written against.
//
// The admin makes about forty calls shaped like sb.from(...).select().eq(...)
// and sb.storage.from(...).list(). Rather than rewrite all of them against the
// new API — forty chances to introduce a bug — this presents the same surface
// and talks to the Worker instead. Only the line that creates the client
// changes.
//
// It implements exactly what the admin actually uses, and nothing else.
(function () {
  function makeClient(cfg) {
    var API = cfg.dataUrl;
    var session = null;
    try { session = localStorage.getItem('armera_session') || null; } catch (e) {}

    function headers(extra) {
      var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
      if (session) h['Authorization'] = 'Bearer ' + session;
      return h;
    }
    function call(path, opts) {
      opts = opts || {};
      return fetch(API + path, {
        method: opts.method || 'GET',
        headers: headers(opts.headers),
        body: opts.body,
        credentials: 'include'
      }).then(function (r) {
        return r.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = t; }
          if (!r.ok) return { data: null, error: { message: (data && data.error) || r.statusText, status: r.status } };
          return { data: data, error: null };
        });
      }).catch(function (e) {
        return { data: null, error: { message: e.message || String(e) } };
      });
    }

    /* ---- table queries ---- */
    function table(name) {
      var q = { _name: name, _filters: {}, _order: null, _limit: null, _single: false, _cols: '*' };
      q.select = function (cols) { q._cols = cols || '*'; return q; };
      q.eq = function (col, val) { q._filters[col] = val; return q; };
      q.gte = function (col, val) { q._filters['gte:' + col] = val; return q; };
      q.order = function (col, o) { q._order = { col: col, asc: !o || o.ascending !== false }; return q; };
      q.limit = function (n) { q._limit = n; return q; };
      q.maybeSingle = function () { q._single = true; return q.then(function (r) { return r; }); };

      q._run = function () {
        if (name === 'site_content') {
          var path = '/rest/v1/site_content?select=' + encodeURIComponent(q._cols === '*' ? 'key,data' : q._cols);
          if (q._filters.key) path += '&key=eq.' + encodeURIComponent(q._filters.key);
          if (q._order) path += '&order=' + q._order.col;
          return call(path).then(function (res) {
            if (res.error) return res;
            var rows = res.data || [];
            if (q._single) return { data: rows[0] || null, error: null };
            return { data: rows, error: null };
          });
        }
        if (name === 'page_views') {
          var since = q._filters['gte:ts'] || '';
          return call('/admin/page_views?since=' + encodeURIComponent(since));
        }
        if (name === 'guarantee_registrations') {
          return call('/admin/guarantees');
        }
        return Promise.resolve({ data: [], error: null });
      };

      q.then = function (res, rej) { return q._run().then(res, rej); };
      q.catch = function (fn) { return q._run().catch(fn); };

      q.update = function (patch) {
        var u = {
          eq: function (col, val) {
            if (name === 'site_content') {
              return call('/admin/content/' + encodeURIComponent(val),
                          { method: 'POST', body: JSON.stringify(patch.data) });
            }
            if (name === 'guarantee_registrations') {
              return call('/admin/guarantees/' + val, { method: 'POST', body: JSON.stringify(patch) });
            }
            return Promise.resolve({ data: null, error: null });
          }
        };
        u.then = function (r) { return u.eq().then(r); };
        return u;
      };
      q.upsert = function (row) {
        return call('/admin/content/' + encodeURIComponent(row.key),
                    { method: 'POST', body: JSON.stringify(row.data) });
      };
      return q;
    }

    /* ---- storage ---- */
    function bucketName(b) { return b === cfg.instructionsBucket ? 'instructions' : b; }
    function storage(bucket) {
      var name = bucketName(bucket);
      return {
        list: function (prefix, opts) {
          return call('/admin/files?bucket=' + encodeURIComponent(name) +
                      '&prefix=' + encodeURIComponent(prefix || ''));
        },
        remove: function (paths) {
          return Promise.all((paths || []).map(function (p) {
            return call('/admin/file/' + name + '/' + encodeURIComponent(p), { method: 'DELETE' });
          })).then(function () { return { data: null, error: null }; });
        },
        createSignedUrl: function (path) {
          // the proof bucket is served through the Worker, behind the same auth
          return Promise.resolve({
            data: { signedUrl: API + '/admin/file/' + name + '/' + encodeURIComponent(path) },
            error: null
          });
        },
        getPublicUrl: function (path) {
          var base = name === 'instructions' ? cfg.instructionsUrl : cfg.assets;
          return { data: { publicUrl: base + '/' + path.split('/').map(encodeURIComponent).join('/') } };
        }
      };
    }

    /* ---- auth ---- */
    var auth = {
      getSession: function () {
        if (!session) return Promise.resolve({ data: { session: null } });
        return call('/auth/me').then(function (r) {
          return { data: { session: r.error ? null : { access_token: session } } };
        });
      },
      getUser: function () {
        return call('/auth/me').then(function (r) {
          if (r.error) return { data: { user: null } };
          return { data: { user: { email: r.data.email,
            user_metadata: Object.assign({ display_name: r.data.display_name }, r.data.prefs || {}) } } };
        });
      },
      signInWithPassword: function (creds) {
        return call('/auth/login', { method: 'POST', body: JSON.stringify(creds) }).then(function (r) {
          if (r.error) return { error: r.error };
          session = r.data.token;
          try { localStorage.setItem('armera_session', session); } catch (e) {}
          return { data: { user: { email: r.data.email } }, error: null };
        });
      },
      signOut: function () {
        session = null;
        try { localStorage.removeItem('armera_session'); } catch (e) {}
        return call('/auth/logout', { method: 'POST' }).then(function () { return {}; });
      },
      updateUser: function (payload) {
        var body = {};
        if (payload.data) {
          body.prefs = {};
          Object.keys(payload.data).forEach(function (k) {
            if (k === 'display_name') body.display_name = payload.data[k];
            else body.prefs[k] = payload.data[k];
          });
        }
        if (payload.password) body.password = payload.password;
        return call('/prefs', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
          if (r.error) return { error: r.error };
          return { data: { user: { email: null, user_metadata: Object.assign({}, body.prefs,
            body.display_name ? { display_name: body.display_name } : {}) } }, error: null };
        });
      }
    };

    return {
      from: table,
      storage: { from: storage },
      auth: auth,
      _token: function () { return session; },
      _api: API
    };
  }

  window.armeraClient = makeClient;
})();
