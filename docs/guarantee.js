// Guarantee registration form.
(function () {
  var cfg = window.ARMERA;
  var form = document.getElementById('guarantee-form');
  if (!cfg || !form) return;

  var rows = document.getElementById('gf-products');
  var msg = document.getElementById('gf-msg');
  var send = document.getElementById('gf-send');
  var proof = document.getElementById('gf-proof');
  var proofState = document.getElementById('gf-proof-state');

  /* product rows */
  function addRow(code, desc) {
    var wrap = document.createElement('div');
    wrap.className = 'gf-product';
    wrap.innerHTML =
      '<label class="gf"><span>Product code</span><input type="text" class="p-code" placeholder="e.g. AT.620.600.11"></label>' +
      '<label class="gf"><span>Product description</span><input type="text" class="p-desc" placeholder="e.g. Atoll 600mm 2 drawer wall hung unit"></label>';
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'abtn abtn--ghost abtn--sm gf-remove';
    rm.textContent = 'Remove';
    rm.addEventListener('click', function () {
      if (rows.children.length > 1) wrap.remove();
    });
    wrap.appendChild(rm);
    if (code) wrap.querySelector('.p-code').value = code;
    if (desc) wrap.querySelector('.p-desc').value = desc;
    rows.appendChild(wrap);
  }
  addRow();
  document.getElementById('gf-add-product').addEventListener('click', function () { addRow(); });

  /* proof upload */
  var proofName = null;
  proof.addEventListener('change', function () {
    var f = proof.files[0];
    if (!f) { proofName = null; proofState.textContent = ''; return; }
    if (f.size > 10 * 1024 * 1024) {
      proof.value = '';
      proofState.textContent = 'That file is larger than 10 MB — please choose a smaller one.';
      return;
    }
    proofState.textContent = 'Uploading…';
    var name = 'proof-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) +
      (f.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    fetch(cfg.supabaseUrl + '/storage/v1/object/guarantee-proof/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': f.type || 'application/octet-stream' },
      body: f
    }).then(function (r) {
      if (r.ok) { proofName = name; proofState.textContent = 'Attached: ' + f.name; }
      else { proofState.textContent = 'We could not attach that file, but you can still register — we will ask for it if needed.'; }
    }).catch(function () {
      proofState.textContent = 'We could not attach that file, but you can still register.';
    });
  });

  /* submit */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'small';
    var missing = [];
    Array.prototype.forEach.call(form.querySelectorAll('[required]'), function (el) {
      var ok = el.value && el.value.trim();
      if (el.type === 'email') ok = ok && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim());
      el.classList.toggle('gf-invalid', !ok);
      if (!ok) missing.push(el);
    });
    if (missing.length) {
      msg.textContent = 'Please complete the highlighted fields.';
      msg.className = 'small gf-error';
      missing[0].focus();
      missing[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    var val = function (n) {
      var el = form.querySelector('[name="' + n + '"]');
      var v = el && el.value ? el.value.trim() : '';
      return v || null;
    };
    var products = Array.prototype.map.call(rows.querySelectorAll('.gf-product'), function (r) {
      return { code: r.querySelector('.p-code').value.trim(), description: r.querySelector('.p-desc').value.trim() };
    }).filter(function (p) { return p.code || p.description; });

    var payload = {
      title: val('title'), first_name: val('first_name'), last_name: val('last_name'), email: val('email'),
      address1: val('address1'), address2: val('address2'), town: val('town'),
      postcode: val('postcode'), country: val('country'),
      retailer_name: val('retailer_name'), purchase_date: val('purchase_date'),
      developer_name: val('developer_name'), moved_in_date: val('moved_in_date'),
      installer_name: val('installer_name'), installer_address1: val('installer_address1'),
      installer_address2: val('installer_address2'), installer_town: val('installer_town'),
      installer_postcode: val('installer_postcode'), installer_country: val('installer_country'),
      products: products, proof_file: proofName
    };

    send.disabled = true;
    msg.textContent = 'Sending…';
    fetch(cfg.supabaseUrl + '/rest/v1/guarantee_registrations', {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/json', Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      send.disabled = false;
      if (r.ok) {
        form.innerHTML = '<div class="gf-done">' +
          '<span class="eyebrow">Thank you</span>' +
          '<h2 style="margin:12px 0 14px">Your guarantee is registered</h2>' +
          '<p>We have your details and will be in touch if we need anything else. ' +
          'Keep your proof of purchase safe — you may be asked for it in the event of a claim.</p>' +
          '<a class="btn" href="' + (cfg.base || '') + '/products/">Back to the collection</a></div>';
        window.scrollTo({ top: form.getBoundingClientRect().top + window.scrollY - 140, behavior: 'smooth' });
      } else {
        msg.className = 'small gf-error';
        msg.innerHTML = 'We could not save your registration just now. Please call ' +
          '<a href="tel:01225251204" style="border-bottom:1px solid var(--line-dark)">01225 251204</a> or email ' +
          '<a href="mailto:info@armera.co.uk" style="border-bottom:1px solid var(--line-dark)">info@armera.co.uk</a> and we will register it for you.';
      }
    }).catch(function () {
      send.disabled = false;
      msg.className = 'small gf-error';
      msg.textContent = 'We could not reach the server. Please check your connection and try again.';
    });
  });
})();
