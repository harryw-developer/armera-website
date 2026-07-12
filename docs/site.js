// ARMERA site interactions
(function () {
  // mobile menu
  var burger = document.querySelector('.burger');
  var menu = document.querySelector('.mobile-menu');
  if (burger && menu) {
    burger.addEventListener('click', function () { menu.classList.add('open'); document.body.style.overflow = 'hidden'; });
    menu.querySelector('.close').addEventListener('click', function () { menu.classList.remove('open'); document.body.style.overflow = ''; });
  }

  // product variant swatches
  var stageImg = document.querySelector('.pdp .stage img');
  var swatchBtns = document.querySelectorAll('.variant-swatches button');
  if (stageImg && swatchBtns.length) {
    swatchBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        swatchBtns.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        var img = btn.getAttribute('data-img');
        if (img) {
          stageImg.style.opacity = '0';
          var pre = new Image();
          pre.onload = function () { stageImg.src = img; stageImg.style.opacity = '1'; };
          pre.src = img;
        }
        var label = document.querySelector('.variant-swatches .label b');
        if (label) label.textContent = btn.getAttribute('data-name') || '';
        var code = btn.getAttribute('data-code');
        document.querySelectorAll('table.pricing tbody tr').forEach(function (tr) {
          tr.classList.toggle('hl', !!code && tr.getAttribute('data-code') === code);
        });
      });
    });
  }

  // gallery thumbs
  var thumbs = document.querySelectorAll('.pdp .thumbs button');
  if (stageImg && thumbs.length) {
    thumbs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        thumbs.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        stageImg.src = btn.getAttribute('data-img');
      });
    });
  }

  // inspiration lightbox
  var figures = Array.prototype.slice.call(document.querySelectorAll('.masonry figure'));
  var lightbox = document.querySelector('.lightbox');
  if (figures.length && lightbox) {
    var lbImg = lightbox.querySelector('img');
    var idx = 0;
    function show(i) {
      idx = (i + figures.length) % figures.length;
      lbImg.src = figures[idx].querySelector('img').getAttribute('data-full') || figures[idx].querySelector('img').src;
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function hide() { lightbox.classList.remove('open'); document.body.style.overflow = ''; }
    figures.forEach(function (f, i) { f.addEventListener('click', function () { show(i); }); });
    lightbox.querySelector('.x').addEventListener('click', hide);
    lightbox.querySelector('.prev').addEventListener('click', function (e) { e.stopPropagation(); show(idx - 1); });
    lightbox.querySelector('.next').addEventListener('click', function (e) { e.stopPropagation(); show(idx + 1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) hide(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') hide();
      if (e.key === 'ArrowLeft') show(idx - 1);
      if (e.key === 'ArrowRight') show(idx + 1);
    });
  }
})();
