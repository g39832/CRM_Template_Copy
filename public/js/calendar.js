// public/js/calendar.js
//
// The Calendar page: approved jobs drawn from their estimated start date for
// as many days as they take (a 3-day job starting Oct 10 covers Oct 10-12).
// Everything comes from the jobs themselves (GET /api/jobs/schedule) — there
// is no separate calendar record — so a job's new date, duration or status,
// or its deletion, shows here the next time the calendar loads. Clicking a
// job opens it on the Dashboard (/main?job=<id>).
//
// Dates are calendar dates ("YYYY-MM-DD") with no time zone; all date maths
// here is done in UTC on those strings so no day ever shifts.
(function () {
  'use strict';

  var VIEWS = ['month', 'week', 'day'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var STORAGE_KEY = 'crm-calendar-view';

  var bodyEl = document.getElementById('calBody');
  var titleEl = document.getElementById('calTitle');
  var noticeEl = document.getElementById('calNotice');
  var state = { view: 'month', date: todayIso(), events: [], activities: [], activitiesSupported: true, activitiesMessage: '', requestToken: 0 };

  // ---------- dates ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function todayIso() {
    var n = new Date();
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  }
  function toDate(s) { return new Date(s + 'T00:00:00Z'); }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function addDays(s, n) { var d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function weekStart(s) { return addDays(s, -toDate(s).getUTCDay()); }
  function monthStart(s) { return s.slice(0, 8) + '01'; }
  function monthEnd(s) {
    var d = toDate(monthStart(s));
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return iso(d);
  }
  function addMonths(s, n) {
    var d = toDate(monthStart(s));
    d.setUTCMonth(d.getUTCMonth() + n);
    return iso(d);
  }
  function isValidIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(toDate(s).getTime()) && iso(toDate(s)) === s; }
  function fmt(s, opts) { return toDate(s).toLocaleDateString('en-US', Object.assign({ timeZone: 'UTC' }, opts)); }
  function rangeText(e) {
    var span = e.duration_days === 1
      ? fmt(e.start, { month: 'short', day: 'numeric' })
      : fmt(e.start, { month: 'short', day: 'numeric' }) + ' – ' + fmt(e.end, { month: 'short', day: 'numeric' });
    return span + ' · ' + e.duration_days + ' day' + (e.duration_days === 1 ? '' : 's');
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Activities on one day, in time order (a blank start time - "any time that
  // day" - sorts first). Activities never change a job: they are only drawn.
  function activitiesOn(day) {
    return state.activities
      .filter(function (a) { return a.activity_date === day; })
      .sort(function (a, b) { return String(a.start_time || '').localeCompare(String(b.start_time || '')) || a.id - b.id; });
  }
  // A small count on the day, so activities are visible without leaving the
  // month/week view (clicking the day shows the full list below the calendar).
  function activityCountBadge(day) {
    var n = state.activitiesSupported ? activitiesOn(day).length : 0;
    if (!n) return '';
    return '<span class="cal-day-act-count" title="' + n + ' activit' + (n === 1 ? 'y' : 'ies') + ' this day">' + n + '</span>';
  }

  // The days the current view shows.
  function viewRange() {
    if (state.view === 'day') return { from: state.date, to: state.date };
    if (state.view === 'week') {
      var ws = weekStart(state.date);
      return { from: ws, to: addDays(ws, 6) };
    }
    return { from: weekStart(monthStart(state.date)), to: addDays(weekStart(monthEnd(state.date)), 6) };
  }

  // ---------- layout ----------
  // Puts each job that touches the week into the first row ("lane") that is
  // free for all of its days, so overlapping jobs stack instead of hiding
  // each other. Every lane is shown — nothing is ever cut off.
  function layoutWeek(ws, events) {
    var we = addDays(ws, 6);
    var segs = events
      .filter(function (e) { return e.start <= we && e.end >= ws; })
      .map(function (e) {
        var s = e.start > ws ? e.start : ws;
        var t = e.end < we ? e.end : we;
        return { e: e, col: diffDays(ws, s), span: diffDays(s, t) + 1, before: e.start < ws, after: e.end > we };
      })
      .sort(function (a, b) { return a.col - b.col || b.span - a.span || a.e.job_id - b.e.job_id; });
    var laneEnds = [];
    segs.forEach(function (x) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) { if (laneEnds[i] < x.col) { lane = i; break; } }
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(-1); }
      laneEnds[lane] = x.col + x.span - 1;
      x.lane = lane;
    });
    return { segs: segs, lanes: laneEnds.length };
  }

  function eventLink(e, extraClass, inner) {
    var label = e.client_name + ' — ' + e.title + ' (' + rangeText(e) + ')';
    return '<a class="cal-event' + (extraClass || '') + '" href="/main?job=' + e.job_id + '" data-job-id="' + e.job_id +
      '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml('Open job: ' + label) + '">' + inner + '</a>';
  }

  function renderWeekRow(ws, opts) {
    var layout = layoutWeek(ws, state.events);
    var today = todayIso();
    var rows = layout.lanes + 2;
    var html = '<div class="cal-week' + (opts.tall ? ' is-tall' : '') + '" style="grid-template-rows:auto' +
      (layout.lanes ? ' repeat(' + layout.lanes + ', auto)' : '') + ' 1fr;">';
    for (var i = 0; i < 7; i++) {
      var day = addDays(ws, i);
      var outside = opts.month && day.slice(0, 7) !== state.date.slice(0, 7);
      html += '<div class="cal-day-bg' + (i === 6 ? ' is-last' : '') + (outside ? ' is-outside' : '') + (day === today ? ' is-today' : '') +
        '" style="grid-column:' + (i + 1) + ';grid-row:1 / span ' + rows + ';"></div>';
      html += '<button type="button" class="cal-day-num' + (day === today ? ' is-today' : '') + (outside ? ' is-outside' : '') +
        '" data-day="' + day + '" style="grid-column:' + (i + 1) + ';grid-row:1;" aria-label="' + escapeHtml(fmt(day, { weekday: 'long', month: 'long', day: 'numeric' })) + ', day view">' +
        (opts.month ? Number(day.slice(8)) : '<span class="cal-day-wd">' + WEEKDAYS[i] + '</span> ' + Number(day.slice(8))) + activityCountBadge(day) + '</button>';
    }
    layout.segs.forEach(function (x) {
      var e = x.e;
      var inner = '<span class="cal-event-client">' + escapeHtml(e.client_name) + '</span>' +
        '<span class="cal-event-title">' + escapeHtml(e.title) + '</span>' +
        (opts.tall ? '<span class="cal-event-meta">' + escapeHtml(rangeText(e)) + '</span>' : '');
      html += '<div class="cal-event-slot" style="grid-column:' + (x.col + 1) + ' / span ' + x.span + ';grid-row:' + (x.lane + 2) + ';">' +
        eventLink(e, (x.before ? ' cont-before' : '') + (x.after ? ' cont-after' : '') + (opts.tall ? ' is-tall' : ''), inner) + '</div>';
    });
    return html + '</div>';
  }

  function weekdayHeader() {
    return '<div class="cal-weekdays" aria-hidden="true">' +
      WEEKDAYS.map(function (d) { return '<div>' + d + '</div>'; }).join('') + '</div>';
  }

  function renderMonth() {
    var r = viewRange();
    var html = weekdayHeader() + '<div class="cal-month">';
    for (var ws = r.from; ws <= r.to; ws = addDays(ws, 7)) html += renderWeekRow(ws, { month: true });
    return html + '</div>';
  }

  function renderWeek() {
    return '<div class="cal-month cal-week-view">' + renderWeekRow(weekStart(state.date), { tall: true }) + '</div>';
  }

  function renderDay() {
    var day = state.date;
    var list = state.events.filter(function (e) { return e.start <= day && e.end >= day; });
    if (!list.length) return '<div class="cal-empty">No scheduled jobs on ' + escapeHtml(fmt(day, { weekday: 'long', month: 'long', day: 'numeric' })) + '.</div>';
    return '<div class="cal-day-list">' + list.map(function (e) {
      var n = diffDays(e.start, day) + 1;
      return eventLink(e, ' cal-day-card',
        '<span class="cal-day-card-client">' + escapeHtml(e.client_name) + '</span>' +
        '<span class="cal-day-card-title">' + escapeHtml(e.title) + '</span>' +
        '<span class="cal-day-card-meta">' + (e.duration_days > 1 ? 'Day ' + n + ' of ' + e.duration_days + ' · ' : '') +
        'Starts ' + escapeHtml(fmt(e.start, { weekday: 'short', month: 'short', day: 'numeric' })) + ' · ' +
        e.duration_days + ' day' + (e.duration_days === 1 ? '' : 's') + '</span>');
    }).join('') + '</div>';
  }

  function renderTitle() {
    var text;
    if (state.view === 'month') text = fmt(state.date, { month: 'long', year: 'numeric' });
    else if (state.view === 'week') {
      var ws = weekStart(state.date);
      var we = addDays(ws, 6);
      text = fmt(ws, { month: 'short', day: 'numeric' }) + ' – ' + fmt(we, { month: 'short', day: 'numeric', year: 'numeric' });
    } else text = fmt(state.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    titleEl.textContent = text;
    document.querySelectorAll('.cal-view-btn').forEach(function (b) {
      var on = b.getAttribute('data-view') === state.view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function render() {
    renderTitle();
    var html = state.view === 'month' ? renderMonth() : state.view === 'week' ? renderWeek() : renderDay();
    var r = viewRange();
    var inView = state.events.filter(function (e) { return e.start <= r.to && e.end >= r.from; }).length;
    if (!inView && state.view !== 'day') {
      html += '<p class="cal-empty-hint">No approved jobs are scheduled in this ' + state.view + '. Open an approved job and set its estimated start date and duration to see it here.</p>';
    }
    bodyEl.innerHTML = html;
    bodyEl.setAttribute('aria-busy', 'false');
  }

  // ---------- data ----------
  function showNotice(text, kind) {
    noticeEl.hidden = !text;
    noticeEl.textContent = text || '';
    noticeEl.className = 'cal-notice' + (kind ? ' is-' + kind : '');
  }

  function load() {
    var r = viewRange();
    var token = ++state.requestToken;
    bodyEl.setAttribute('aria-busy', 'true');
    renderTitle();
    fetch('/api/jobs/schedule?from=' + r.from + '&to=' + r.to)
      .then(function (res) {
        if (res.status === 401) { window.location.href = '/'; return null; }
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Failed to load the schedule');
          return data;
        });
      })
      .then(function (data) {
        if (!data || token !== state.requestToken) return;
        if (data.supported === false) {
          showNotice(data.message || 'Scheduling is not available yet.', 'warning');
          state.events = [];
        } else {
          showNotice('');
          state.events = (data.events || []).map(function (e) {
            return Object.assign({}, e, { duration_days: Number(e.duration_days) });
          });
        }
        render();
      })
      .catch(function (err) {
        if (token !== state.requestToken) return;
        console.error(err);
        showNotice((err && err.message) || 'Failed to load the schedule', 'error');
        state.events = [];
        render();
      });
    loadActivities(r, token);
  }

  // Activities (calendar_activities, v11) are a separate stream from the
  // schedule: they are fetched in parallel and their failure only hides the
  // Activities panel. They never approve, schedule or price a job.
  function loadActivities(r, token) {
    var panel = document.getElementById('calActivityPanel');
    if (!window.CrmActivities) { if (panel) panel.hidden = true; return; }
    window.CrmActivities.api.listRange(r.from, r.to)
      .then(function (data) {
        if (token !== state.requestToken) return;
        state.activitiesSupported = !(data && data.supported === false);
        state.activities = state.activitiesSupported ? ((data && data.activities) || []) : [];
        state.activitiesMessage = (data && data.message) || '';
        renderActivityPanel();
        render();
      })
      .catch(function (err) {
        if (token !== state.requestToken) return;
        console.error(err);
        state.activitiesSupported = false;
        state.activities = [];
        state.activitiesMessage = 'Activities could not be loaded.';
        renderActivityPanel();
        render();
      });
  }

  function renderActivityPanel() {
    var panel = document.getElementById('calActivityPanel');
    var listEl = document.getElementById('calActivityList');
    var addBtn = document.getElementById('calAddActivityBtn');
    if (!panel || !listEl || !window.CrmActivities) return;
    panel.hidden = false;
    if (!state.activitiesSupported) {
      listEl.innerHTML = '<div class="field-hint">' + escapeHtml(state.activitiesMessage || 'Activities are not available yet.') + '</div>';
      if (addBtn) addBtn.hidden = true;
      return;
    }
    if (addBtn) addBtn.hidden = false;
    window.CrmActivities.renderList(listEl, state.activities, {
      showClient: true,
      showJob: true,
      emptyText: 'No activities in this ' + state.view + '. Use + Activity to add an appointment or reminder.',
      onOpen: function (activity) {
        window.CrmActivities.openEditor({ activity: activity, links: true, onChange: function () { load(); } });
      }
    });
  }

  function syncUrl() {
    var params = new URLSearchParams(window.location.search);
    params.set('view', state.view);
    params.set('date', state.date);
    window.history.replaceState({}, document.title, window.location.pathname + '?' + params.toString());
    try { localStorage.setItem(STORAGE_KEY, state.view); } catch (e) { /* storage unavailable */ }
  }

  function go(view, date) {
    if (view) state.view = view;
    if (date) state.date = date;
    syncUrl();
    load();
  }

  function step(dir) {
    if (state.view === 'month') go(null, addMonths(state.date, dir));
    else go(null, addDays(state.date, dir * (state.view === 'week' ? 7 : 1)));
  }

  // ---------- wiring ----------
  document.getElementById('calTodayBtn').addEventListener('click', function () { go(null, todayIso()); });
  document.getElementById('calPrevBtn').addEventListener('click', function () { step(-1); });
  document.getElementById('calNextBtn').addEventListener('click', function () { step(1); });
  document.querySelectorAll('.cal-view-btn').forEach(function (b) {
    b.addEventListener('click', function () { go(b.getAttribute('data-view')); });
  });
  bodyEl.addEventListener('click', function (e) {
    var dayBtn = e.target.closest('.cal-day-num');
    if (dayBtn) go('day', dayBtn.getAttribute('data-day'));
  });

  // "+ Activity": pick one of the clients this user may see (admins see all)
  // and open the shared editor. Saving never touches a job.
  (function wireActivityAdd() {
    var addBtn = document.getElementById('calAddActivityBtn');
    if (!addBtn || !window.CrmActivities) return;
    addBtn.addEventListener('click', function () {
      fetch('/api/search?q=', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (clients) {
          window.CrmActivities.openEditor({
            clients: (Array.isArray(clients) ? clients : []).map(function (c) { return { id: c.id, name: c.name }; }),
            date: state.date,
            onChange: function () { load(); }
          });
        });
    });
  })();
  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  (function initThemeToggle() {
    var btn = document.getElementById('themeToggleBtn');
    if (!btn || !window.crmTheme) return;
    function paint() {
      btn.innerHTML = '<i data-lucide="' + (window.crmTheme.getTheme() === 'dark' ? 'sun' : 'moon') + '"></i>';
      if (window.lucide) window.lucide.createIcons();
    }
    paint();
    btn.addEventListener('click', function () { window.crmTheme.toggleTheme(); paint(); });
    document.addEventListener('crm-theme-change', paint);
  })();

  if (window.__USER__ && window.__USER__.role === 'admin') {
    var fin = document.getElementById('navFinanceLink');
    if (fin) fin.style.display = '';
  }

  // Start from ?view=&date= (links from a job), else the last view used.
  (function init() {
    var params = new URLSearchParams(window.location.search);
    var view = params.get('view');
    if (!VIEWS.includes(view)) {
      try { view = localStorage.getItem(STORAGE_KEY); } catch (e) { view = null; }
    }
    if (!VIEWS.includes(view)) view = 'month';
    var date = params.get('date');
    state.view = view;
    state.date = isValidIso(date) ? date : todayIso();
    if (window.lucide) window.lucide.createIcons();
    syncUrl();
    load();
  })();

  // Coming back to this tab after editing a job: show the latest schedule.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') load();
  });

  // Company name in the header, like the other pages.
  fetch('/api/company-profile').then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
    var name = p && p.settings && p.settings.businessName;
    if (name && name !== 'Your Company Name') {
      document.title = name + ' — Calendar';
      var k = document.querySelector('.page-kicker');
      if (k) k.textContent = name;
    }
  }).catch(function () { /* keep the default */ });
})();
