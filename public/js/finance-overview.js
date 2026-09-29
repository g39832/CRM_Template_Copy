// Financial Overview — the visual cards at the top of the Finance page.
//
// Read-only: it draws what two existing-style endpoints return and never
// changes a number.
//   /api/finance/summary   — the year totals (same figures as the Year
//                            Totals & Overrides table, overrides included)
//   /api/finance/overview  — revenue/cost/profit, money received by month,
//                            revenue by salesperson, costs by category
// Redraws when the year changes and whenever the page fires financeUpdated.
(function () {
  var root = document.getElementById('sectionOverview');
  if (!root) return;

  var yearInput = document.getElementById('finance-year');
  var tooltip = document.getElementById('foTooltip');
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var requestId = 0;

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(value) {
    var n = Number(value) || 0;
    var text = '$' + (window.crmMoney ? window.crmMoney.format(Math.abs(n)) : Math.abs(n).toFixed(2));
    return n < 0 ? '−' + text : text;
  }
  // Axis labels only: $0, $500, $1.2k, $15k, $1.5M
  function shortMoney(value) {
    var n = Math.abs(Number(value) || 0);
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n);
  }
  function pct(value, digits) {
    return (Number(value) || 0).toFixed(digits === undefined ? 1 : digits).replace(/\.0$/, '') + '%';
  }
  // A "nice" axis maximum (1, 2, 2.5, 5 × 10^n) at or above the value.
  function niceMax(value) {
    if (!(value > 0)) return 1;
    var exp = Math.pow(10, Math.floor(Math.log10(value)));
    var steps = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < steps.length; i++) if (steps[i] * exp >= value) return steps[i] * exp;
    return 10 * exp;
  }
  function currentYear() {
    var y = parseInt(yearInput && yearInput.value, 10);
    return y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
  }
  function marginStatus(m) {
    if (m === null || m === undefined || !Number.isFinite(Number(m))) return null;
    if (m >= 30) return { tone: 'green', icon: 'circle-check', label: 'Healthy', color: 'var(--success-text)' };
    if (m >= 15) return { tone: 'amber', icon: 'triangle-alert', label: 'Watch', color: 'var(--warning-text)' };
    return { tone: 'red', icon: 'circle-alert', label: 'Low', color: 'var(--danger-text)' };
  }
  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  // ---------- KPI tiles ----------
  function kpi(tone, icon, label, value, meta, extra) {
    return '<div class="fo-kpi fo-kpi--' + tone + '">' +
      '<div class="fo-kpi-top"><span class="fo-kpi-icon"><i data-lucide="' + icon + '"></i></span>' +
      '<span class="fo-kpi-label">' + esc(label) + '</span></div>' +
      '<div class="fo-kpi-value">' + value + '</div>' +
      (meta ? '<div class="fo-kpi-meta">' + meta + '</div>' : '') +
      (extra || '') +
    '</div>';
  }

  function renderKpis(summary) {
    var el = document.getElementById('foKpis');
    if (!summary) {
      el.innerHTML = '<div class="fo-empty" style="grid-column:1/-1;">Could not load this year’s totals.</div>';
      return;
    }
    var expected = Number(summary.totalExpected) || 0;
    var received = Number(summary.totalReceived) || 0;
    var remaining = Number(summary.totalRemaining) || 0;
    var collected = expected > 0 ? Math.max(0, Math.min(100, (received / expected) * 100)) : 0;
    var m = summary.avgMarginPct;
    var status = marginStatus(m);
    el.innerHTML =
      kpi('blue', 'briefcase', 'Expected Earnings', money(expected), 'Year total for ' + esc(summary.year)) +
      kpi('green', 'wallet', 'Received', money(received),
        expected > 0 ? pct(collected, 0) + ' of expected collected' : 'Payments recorded this year',
        '<div class="fo-progress" role="img" aria-label="' + pct(collected, 0) + ' collected"><span style="width:' + collected.toFixed(1) + '%"></span></div>') +
      kpi(remaining > 0.005 ? 'amber' : 'slate', 'hourglass', 'Remaining', money(remaining), remaining > 0.005 ? 'Still to be collected' : 'Nothing outstanding') +
      kpi('slate', 'users', 'Clients', esc(Number(summary.totalClients) || 0), 'Clients added in ' + esc(summary.year)) +
      kpi(status ? status.tone : 'slate', 'percent', 'Avg Margin', m === null || m === undefined ? '—' : pct(m),
        status ? '<span class="fo-status" style="color:' + status.color + ';"><i data-lucide="' + status.icon + '"></i>' + status.label + '</span>' : 'Needs a price and a cost on the work');
  }

  // ---------- Revenue / cost / profit ----------
  function renderProfit(data) {
    var el = document.getElementById('foProfit');
    var t = data.totals;
    if (!(t.revenue > 0.005) && !(t.cost > 0.005)) {
      el.innerHTML = '<div class="fo-empty">No priced work for ' + esc(data.year) + ' yet.</div>';
      return;
    }
    var max = Math.max(t.revenue, t.cost, Math.abs(t.profit), 1);
    var rows = [
      { label: 'Revenue', value: t.revenue, color: 'var(--fo-revenue)' },
      { label: 'Cost', value: t.cost, color: 'var(--fo-cost)' },
      { label: 'Profit', value: t.profit, color: t.profit < 0 ? 'var(--danger)' : 'var(--fo-profit)' }
    ];
    var bars = rows.map(function (r) {
      var w = Math.abs(r.value) / max * 100;
      return '<div class="fo-bar-row" data-tip="' + esc(r.label + ' · ' + money(r.value)) + '">' +
        '<span class="fo-bar-label"><span class="fo-swatch" style="background:' + r.color + '"></span>' + r.label + '</span>' +
        '<div class="fo-bar-track"><div class="fo-bar-fill" style="width:' + w.toFixed(1) + '%;background:' + r.color + '"></div></div>' +
        '<span class="fo-bar-value' + (r.value < 0 ? ' is-negative' : '') + '">' + money(r.value) + '</span>' +
      '</div>';
    }).join('');

    var m = t.marginPct;
    var status = marginStatus(m);
    var radius = 48;
    var circ = 2 * Math.PI * radius;
    var arc = m === null ? 0 : Math.max(0, Math.min(100, m)) / 100 * circ;
    var ringColor = status ? (status.tone === 'green' ? 'var(--success)' : status.tone === 'amber' ? 'var(--warning)' : 'var(--danger)') : 'var(--border-strong)';
    var ring = '<div class="fo-ring">' +
      '<svg viewBox="0 0 124 124" role="img" aria-label="Profit margin ' + (m === null ? 'not available' : pct(m)) + '">' +
        '<circle cx="62" cy="62" r="' + radius + '" fill="none" stroke="var(--fo-track)" stroke-width="12"></circle>' +
        '<circle cx="62" cy="62" r="' + radius + '" fill="none" stroke="' + ringColor + '" stroke-width="12" stroke-linecap="round"' +
          ' stroke-dasharray="' + arc.toFixed(2) + ' ' + circ.toFixed(2) + '" transform="rotate(-90 62 62)"></circle>' +
        '<text x="62" y="62" text-anchor="middle" class="fo-ring-value">' + (m === null ? '—' : pct(m)) + '</text>' +
        '<text x="62" y="80" text-anchor="middle" class="fo-ring-label">margin</text>' +
      '</svg>' +
      (status ? '<span class="fo-status" style="color:' + status.color + ';"><i data-lucide="' + status.icon + '"></i>' + status.label + '</span>' : '') +
    '</div>';

    el.innerHTML = '<div class="fo-profit"><div class="fo-bars">' + bars + '</div>' + ring + '</div>' +
      '<div class="fo-chart-foot">' + esc(t.jobs) + ' job' + (t.jobs === 1 ? '' : 's') + ' and ' + esc(t.clients) + ' client' + (t.clients === 1 ? '' : 's') +
      ' added in ' + esc(data.year) + ' · ' + money(t.outstanding) + ' still outstanding on them</div>';
  }

  // ---------- Money received by month ----------
  function renderMonthly(data) {
    var el = document.getElementById('foMonthly');
    var months = data.monthly || [];
    var values = months.map(function (m) { return Number(m.received) || 0; });
    var total = values.reduce(function (a, b) { return a + b; }, 0);
    if (!values.some(function (v) { return Math.abs(v) > 0.005; })) {
      el.innerHTML = '<div class="fo-empty">No payments recorded in ' + esc(data.year) + ' yet.</div>';
      return;
    }
    var top = niceMax(Math.max.apply(null, values.map(function (v) { return Math.max(v, 0); })));
    var peakIdx = values.indexOf(Math.max.apply(null, values));
    var cols = values.map(function (v, i) {
      var h = Math.max(0, v) / top * 100;
      var label = MONTHS[i] + ' ' + data.year + ' · ' + money(v);
      return '<div class="fo-col" tabindex="0" data-tip="' + esc(label) + '" aria-label="' + esc(label) + '">' +
        '<div class="fo-col-fill" style="height:' + h.toFixed(1) + '%"></div></div>';
    }).join('');
    var peakLeft = (peakIdx + 0.5) / 12 * 100;
    var peakBottom = Math.max(0, values[peakIdx]) / top * 100;
    var table = '<table class="fo-visually-hidden"><caption>Money received by month, ' + esc(data.year) + '</caption><tr><th>Month</th><th>Received</th></tr>' +
      values.map(function (v, i) { return '<tr><td>' + MONTHS[i] + '</td><td>' + money(v) + '</td></tr>'; }).join('') + '</table>';

    el.innerHTML =
      '<div class="fo-columns">' +
        '<div class="fo-yaxis" aria-hidden="true"><span style="bottom:100%">' + shortMoney(top) + '</span><span style="bottom:50%">' + shortMoney(top / 2) + '</span><span style="bottom:0">$0</span></div>' +
        '<div class="fo-plot">' + cols +
          '<span class="fo-col-peak" aria-hidden="true" style="left:' + peakLeft.toFixed(2) + '%;bottom:' + peakBottom.toFixed(1) + '%;">' + shortMoney(values[peakIdx]) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="fo-xaxis" aria-hidden="true">' + MONTHS.map(function (m) { return '<span>' + m.charAt(0) + '</span>'; }).join('') + '</div>' +
      '<div class="fo-chart-foot">' + money(total) + ' received in ' + esc(data.year) + ' · best month ' + MONTHS[peakIdx] + '</div>' + table;
  }

  // ---------- Sales by salesperson ----------
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  }
  function renderSales(data) {
    var el = document.getElementById('foSales');
    var people = data.salespeople || [];
    if (!people.length) {
      el.innerHTML = '<div class="fo-empty">No sales recorded for ' + esc(data.year) + ' yet.</div>';
      return;
    }
    el.innerHTML = '<div class="fo-list">' + people.map(function (p) {
      var share = Math.max(0, Math.min(100, Number(p.share) || 0));
      return '<div class="fo-list-row" data-tip="' + esc(p.name + ' · ' + money(p.revenue) + ' · ' + pct(share) + ' of revenue') + '">' +
        '<div class="fo-list-top">' +
          '<span class="fo-list-name"><span class="fo-avatar" aria-hidden="true">' + esc(initials(p.name)) + '</span><span>' + esc(p.name) + '</span></span>' +
          '<span class="fo-list-amount">' + money(p.revenue) + '</span>' +
        '</div>' +
        '<div class="fo-share" role="img" aria-label="' + esc(pct(share)) + ' of revenue"><span style="width:' + share.toFixed(1) + '%;background:var(--fo-revenue)"></span></div>' +
        '<div class="fo-list-meta"><span>' + p.jobs + ' job' + (p.jobs === 1 ? '' : 's') + ' · ' + p.clients + ' client' + (p.clients === 1 ? '' : 's') + ' · ' + money(p.received) + ' received</span>' +
          '<span>' + pct(share) + ' of revenue</span></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  // ---------- Costs by category ----------
  function renderCosts(data) {
    var el = document.getElementById('foCosts');
    var rows = data.costByCategory || [];
    if (!rows.length) {
      el.innerHTML = '<div class="fo-empty">No costs recorded for ' + esc(data.year) + ' yet. Add costs inside each job under Job Costs.</div>';
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.amount); }).concat([1]));
    el.innerHTML = '<div class="fo-list">' + rows.map(function (r) {
      var color = r.kind === 'category' ? 'var(--fo-cost)' : 'var(--border-strong)';
      var w = Math.abs(r.amount) / max * 100;
      return '<div class="fo-list-row" data-tip="' + esc(r.name + ' · ' + money(r.amount) + ' · ' + pct(r.share) + ' of cost') + '">' +
        '<div class="fo-list-top"><span class="fo-list-name"><span class="fo-swatch" style="background:' + color + '"></span><span>' + esc(r.name) + '</span></span>' +
          '<span class="fo-list-amount">' + money(r.amount) + '</span></div>' +
        '<div class="fo-share"><span style="width:' + w.toFixed(1) + '%;background:' + color + '"></span></div>' +
        '<div class="fo-list-meta"><span></span><span>' + pct(r.share) + ' of total cost</span></div>' +
      '</div>';
    }).join('') +
    '<div class="fo-total-row"><span>Total cost</span><span>' + money(data.totals.cost) + '</span></div></div>';
  }

  // ---------- Tooltip (hover + keyboard focus) ----------
  function showTip(target, x, y) {
    if (!tooltip) return;
    tooltip.textContent = target.getAttribute('data-tip');
    tooltip.hidden = false;
    var w = tooltip.offsetWidth;
    var left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2));
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(8, y - tooltip.offsetHeight - 10) + 'px';
  }
  function hideTip() { if (tooltip) tooltip.hidden = true; }
  root.addEventListener('mousemove', function (e) {
    var t = e.target.closest('[data-tip]');
    if (t && root.contains(t)) showTip(t, e.clientX, e.clientY); else hideTip();
  });
  root.addEventListener('mouseleave', hideTip);
  root.addEventListener('focusin', function (e) {
    var t = e.target.closest('[data-tip]');
    if (!t) return;
    var r = t.getBoundingClientRect();
    showTip(t, r.left + r.width / 2, r.top);
  });
  root.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------- Load ----------
  function fetchJson(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function load() {
    var year = currentYear();
    var id = ++requestId;
    Promise.allSettled([
      fetchJson('/api/finance/summary?year=' + year),
      fetchJson('/api/finance/overview?year=' + year)
    ]).then(function (results) {
      if (id !== requestId) return; // a newer year was picked meanwhile
      renderKpis(results[0].status === 'fulfilled' ? results[0].value : null);
      if (results[1].status === 'fulfilled') {
        var data = results[1].value;
        renderProfit(data);
        renderMonthly(data);
        renderSales(data);
        renderCosts(data);
      } else {
        console.error('Finance overview failed to load:', results[1].reason);
        ['foProfit', 'foMonthly', 'foSales', 'foCosts'].forEach(function (elId) {
          document.getElementById(elId).innerHTML = '<div class="fo-empty">Could not load this chart. Try reloading the page.</div>';
        });
      }
      icons();
    });
  }

  var debounce = null;
  function scheduleLoad() {
    clearTimeout(debounce);
    debounce = setTimeout(load, 250);
  }
  if (yearInput) {
    yearInput.addEventListener('change', scheduleLoad);
    yearInput.addEventListener('input', scheduleLoad);
  }
  document.addEventListener('financeUpdated', scheduleLoad);
  load();
})();
