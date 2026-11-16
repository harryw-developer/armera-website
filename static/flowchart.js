// Flow-rate charts, drawn from the figures held against a product.
//
// One place draws the chart for the product page and for the preview in the
// admin, so what staff see while typing is exactly what customers get. Nothing
// here is a picture file: the chart is rebuilt from the numbers every time, so
// changing a figure in the admin changes the chart.
//
// A product's figures look like:
//   { series: [ { label: 'Spout', points: [[0.2, 10.3], [0.5, 16.1], …] } ], note: '…' }
// where each point is [pressure in bar, flow in litres per minute].
(function () {
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var num = function (n) { return String(Math.round(n * 100) / 100); };

  // Keep only what can be drawn: real numbers, in pressure order.
  function clean(flow) {
    if (!flow || !Array.isArray(flow.series)) return null;
    var series = flow.series.map(function (s) {
      var pts = (Array.isArray(s && s.points) ? s.points : []).map(function (p) {
        return [Number(p && p[0]), Number(p && p[1])];
      }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]) && p[0] > 0 && p[1] >= 0; })
        .sort(function (a, b) { return a[0] - b[0]; });
      return { label: String((s && s.label) || '').trim(), points: pts };
    }).filter(function (s) { return s.points.length; });
    if (!series.length) return null;
    return { series: series, note: String(flow.note || '').trim() };
  }

  // A round number at or above the largest value, and the steps up to it.
  function scale(max) {
    var steps = [1, 2, 2.5, 5, 10];
    var pow = Math.pow(10, Math.floor(Math.log(max / 4) / Math.LN10));
    var step = pow;
    for (var i = 0; i < steps.length; i++) { step = steps[i] * pow; if (max / step <= 5) break; }
    var top = Math.ceil(max / step) * step;
    var ticks = [];
    for (var t = 0; t <= top + step / 1000; t += step) ticks.push(Math.round(t * 1000) / 1000);
    return { top: top, ticks: ticks };
  }

  // Each line is told apart by tone and by dash, never by colour alone.
  var STYLES = [
    { stroke: '#232220', dash: '' },
    { stroke: '#8a867e', dash: '' },
    { stroke: '#232220', dash: '5 4' },
    { stroke: '#8a867e', dash: '5 4' },
    { stroke: '#232220', dash: '1.5 4' },
    { stroke: '#8a867e', dash: '1.5 4' }
  ];

  function svg(flow) {
    var f = clean(flow);
    if (!f) return '';
    var W = 640, H = 340, L = 54, R = 20, T = 16, B = 46;
    var iw = W - L - R, ih = H - T - B;
    var maxX = 0, maxY = 0;
    f.series.forEach(function (s) { s.points.forEach(function (p) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }); });
    var xTop = Math.max(1, Math.ceil(maxX));
    var ys = scale(maxY || 1);
    var X = function (v) { return L + (v / xTop) * iw; };
    var Y = function (v) { return T + ih - (v / ys.top) * ih; };
    var r1 = function (n) { return Math.round(n * 10) / 10; };

    var label = f.series.map(function (s) { return s.label; }).filter(Boolean).join(', ');
    var out = '<svg class="flow-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc('Flow rate in litres per minute against water pressure in bar' + (label ? ': ' + label : '')) + '">';

    ys.ticks.forEach(function (t) {
      out += '<line class="fc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + r1(Y(t)) + '" y2="' + r1(Y(t)) + '"/>' +
             '<text class="fc-ax" x="' + (L - 10) + '" y="' + r1(Y(t) + 4) + '" text-anchor="end">' + num(t) + '</text>';
    });
    var xt = xTop <= 4 ? 0.5 : 1;
    for (var x = 0; x <= xTop + 0.001; x += xt) {
      out += '<line class="fc-tick" x1="' + r1(X(x)) + '" x2="' + r1(X(x)) + '" y1="' + (T + ih) + '" y2="' + (T + ih + 5) + '"/>' +
             '<text class="fc-ax" x="' + r1(X(x)) + '" y="' + (T + ih + 20) + '" text-anchor="middle">' + num(x) + '</text>';
    }
    out += '<line class="fc-base" x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '"/>';
    out += '<text class="fc-title" x="' + (L + iw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">Pressure (bar)</text>';
    out += '<text class="fc-title" transform="translate(14 ' + (T + ih / 2) + ') rotate(-90)" text-anchor="middle">Flow (litres per minute)</text>';

    f.series.forEach(function (s, i) {
      var st = STYLES[i % STYLES.length];
      var d = s.points.map(function (p, n) { return (n ? 'L' : 'M') + r1(X(p[0])) + ' ' + r1(Y(p[1])); }).join(' ');
      out += '<path d="' + d + '" fill="none" stroke="' + st.stroke + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"' +
             (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '') + '/>';
      s.points.forEach(function (p) {
        out += '<circle cx="' + r1(X(p[0])) + '" cy="' + r1(Y(p[1])) + '" r="3.2" fill="#fff" stroke="' + st.stroke + '" stroke-width="1.4">' +
               '<title>' + esc((s.label ? s.label + ': ' : '') + num(p[1]) + ' L/min at ' + num(p[0]) + ' bar') + '</title></circle>';
      });
    });
    return out + '</svg>';
  }

  // The key under the chart, only when there is more than one line to tell apart.
  function legend(flow) {
    var f = clean(flow);
    if (!f || (f.series.length < 2 && !f.series[0].label)) return '';
    return '<ul class="flow-key">' + f.series.map(function (s, i) {
      var st = STYLES[i % STYLES.length];
      return '<li><svg viewBox="0 0 34 8" aria-hidden="true"><line x1="1" x2="33" y1="4" y2="4" stroke="' + st.stroke +
        '" stroke-width="1.6"' + (st.dash ? ' stroke-dasharray="' + st.dash + '"' : '') + '/></svg>' +
        esc(s.label || 'Flow') + '</li>';
    }).join('') + '</ul>';
  }

  // The same figures as a table, for anyone who wants the exact numbers.
  function table(flow) {
    var f = clean(flow);
    if (!f) return '';
    var bars = [];
    f.series.forEach(function (s) { s.points.forEach(function (p) { if (bars.indexOf(p[0]) === -1) bars.push(p[0]); }); });
    bars.sort(function (a, b) { return a - b; });
    var solo = f.series.length === 1 && !f.series[0].label;
    var out = '<table class="flow-table"><thead><tr><th>' + (solo ? 'Pressure' : '') + '</th>' +
      bars.map(function (b) { return '<th>' + num(b) + ' bar</th>'; }).join('') + '</tr></thead><tbody>';
    f.series.forEach(function (s) {
      out += '<tr><th scope="row">' + esc(solo ? 'Litres per minute' : (s.label || 'Flow')) + '</th>' + bars.map(function (b) {
        var hit = s.points.filter(function (p) { return p[0] === b; })[0];
        return '<td>' + (hit ? num(hit[1]) : '–') + '</td>';
      }).join('') + '</tr>';
    });
    return out + '</tbody></table>' + (solo ? '' : '<p class="flow-unit">Litres per minute</p>');
  }

  // Everything together, as it appears on a product page.
  function block(flow) {
    var f = clean(flow);
    if (!f) return '';
    return '<div class="flow"><span class="eyebrow">Performance</span><h3>Flow rates</h3>' +
      '<div class="flow-grid"><div class="flow-plot">' + svg(f) + legend(f) + '</div>' +
      '<div class="flow-figs">' + table(f) + (f.note ? '<p class="flow-note">' + esc(f.note) + '</p>' : '') +
      '</div></div></div>';
  }

  window.armeraFlow = { clean: clean, svg: svg, legend: legend, table: table, block: block };
})();
