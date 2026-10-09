// Calendar activities in the browser (window.CrmActivities): the list shown
// on a client page and inside a job, and the window used to add, read, edit,
// complete or (admins) delete one. Used by main.html and calendar.html.
//
// An activity is an appointment or reminder in the customer process ("Send
// quote", "Contract signing 6:45 PM"), not scheduled work: saving one never
// changes a job's status, schedule or money. Dates/times are shown exactly as
// typed ("YYYY-MM-DD" and 24-hour "HH:MM" from the server) — never shifted by
// a time zone.
(function () {
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // "18:45" -> "6:45 PM"
  function formatTime(hm) {
    var m = String(hm || '').match(/^(\d{2}):(\d{2})/);
    if (!m) return '';
    var h = Number(m[1]);
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m[2] + ' ' + suffix;
  }

  // "2026-10-20" -> "Tue, Oct 20, 2026" (read as a calendar date, no zone).
  function formatDate(ymd, opts) {
    var d = new Date(String(ymd || '') + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return String(ymd || '');
    return d.toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }, opts || {}));
  }

  function timeText(a) {
    if (!a.start_time) return 'Any time';
    return formatTime(a.start_time) + (a.end_time ? ' – ' + formatTime(a.end_time) : '');
  }

  // Today on this device's calendar, "YYYY-MM-DD".
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function isAdmin() {
    return Boolean(window.__USER__ && window.__USER__.role === 'admin');
  }

  async function request(method, url, body) {
    var res = await fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'Request failed (' + res.status + ')');
    return data;
  }

  var api = {
    listForClient: function (clientId) { return request('GET', '/api/clients/' + clientId + '/activities'); },
    listForJob: function (jobId) { return request('GET', '/api/jobs/' + jobId + '/activities'); },
    listRange: function (from, to) { return request('GET', '/api/activities?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)); },
    get: function (id) { return request('GET', '/api/activities/' + id); },
    create: function (payload) { return request('POST', '/api/activities', payload); },
    update: function (id, payload) { return request('PUT', '/api/activities/' + id, payload); },
    remove: function (id) { return request('DELETE', '/api/activities/' + id); }
  };

  // ---------- list ----------
  // Overdue (pending, before today), Upcoming (pending, today or later) and
  // Completed, each in date/time order.
  function renderList(container, activities, options) {
    options = options || {};
    var list = activities || [];
    if (!list.length) {
      container.innerHTML = '<div class="field-hint">' + esc(options.emptyText || 'No activities yet.') + '</div>';
      return;
    }
    var t = today();
    var groups = [
      { name: 'Overdue', rows: list.filter(function (a) { return a.status !== 'completed' && a.activity_date < t; }) },
      { name: 'Upcoming', rows: list.filter(function (a) { return a.status !== 'completed' && a.activity_date >= t; }) },
      { name: 'Completed', rows: list.filter(function (a) { return a.status === 'completed'; }).reverse() }
    ];
    container.innerHTML = groups.filter(function (g) { return g.rows.length; }).map(function (g) {
      return '<div class="activity-group"><div class="activity-group-title">' + g.name + ' <span class="summary-count">' + g.rows.length + '</span></div>' +
        g.rows.map(function (a) {
          var context = [];
          if (options.showClient && a.client_name) context.push(esc(a.client_name));
          if (options.showJob !== false && a.job_title) context.push('Job: ' + esc(a.job_title));
          return '<button type="button" class="activity-row' + (a.status === 'completed' ? ' is-completed' : '') + (g.name === 'Overdue' ? ' is-overdue' : '') + '" data-activity-id="' + a.id + '">' +
            '<span class="activity-row-when"><span class="activity-row-date">' + esc(formatDate(a.activity_date, { weekday: 'short', year: undefined })) + '</span>' +
            '<span class="activity-row-time">' + esc(timeText(a)) + '</span></span>' +
            '<span class="activity-row-main"><span class="activity-row-title">' + esc(a.title) + '</span>' +
            (context.length ? '<span class="activity-row-sub">' + context.join(' · ') + '</span>' : '') + '</span>' +
            '<span class="activity-chip' + (a.status === 'completed' ? ' is-done' : '') + '">' + (a.status === 'completed' ? 'Completed' : 'Pending') + '</span>' +
          '</button>';
        }).join('') + '</div>';
    }).join('');
    container.querySelectorAll('[data-activity-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var a = list.find(function (x) { return Number(x.id) === Number(btn.dataset.activityId); });
        if (a && options.onOpen) options.onOpen(a);
      });
    });
  }

  // ---------- editor ----------
  // opts:
  //   activity   an existing activity to read/edit (omit to create)
  //   clientId / clientName   the client (required when creating, unless `clients`)
  //   clients    [{id, name}] — creating from the Calendar: pick the client
  //   jobId      pre-selected job when creating from inside a job
  //   date       pre-filled date when creating ("YYYY-MM-DD")
  //   onChange   called after a save, completion or delete
  //   links      true to show "Open client" / "Open job" links (Calendar)
  function openEditor(opts) {
    opts = opts || {};
    var existing = opts.activity || null;
    var creating = !existing;
    var admin = isAdmin();
    var old = document.getElementById('activityModalOverlay');
    if (old) old.remove();

    var a = existing || {
      client_id: opts.clientId || null,
      client_name: opts.clientName || '',
      job_id: opts.jobId || null,
      title: '',
      notes: '',
      activity_date: opts.date || today(),
      start_time: null,
      end_time: null,
      status: 'pending'
    };
    var pickClient = creating && Array.isArray(opts.clients);

    var modal = document.createElement('div');
    modal.id = 'activityModalOverlay';
    modal.className = 'job-modal-overlay activity-modal-overlay';
    modal.innerHTML =
      '<div class="job-modal-card activity-modal-card" role="dialog" aria-modal="true" aria-labelledby="activityModalHeading">' +
        '<button type="button" class="job-modal-close" data-act="close" aria-label="Close">&times;</button>' +
        '<div class="job-modal-kicker" id="activityModalHeading">' + (creating ? 'New activity' : 'Activity') +
          ' <span class="activity-kind-note">Appointment or reminder — not scheduled work</span></div>' +
        '<div class="job-modal-field"><label for="act-client">Client</label>' +
          (pickClient
            ? '<select id="act-client" required><option value="">Choose a client…</option>' +
                opts.clients.map(function (c) { return '<option value="' + c.id + '"' + (Number(c.id) === Number(a.client_id) ? ' selected' : '') + '>' + esc(c.name || 'Unnamed client') + '</option>'; }).join('') +
              '</select>'
            : '<div class="job-modal-readout" id="act-client-readout">' + esc(a.client_name || 'Client') + '</div>') +
        '</div>' +
        '<div class="job-modal-field"><label for="act-job">Job (optional)</label>' +
          '<select id="act-job"><option value="">No job — client only</option></select>' +
          '<span class="field-hint">Any of this client’s jobs, approved or not.</span></div>' +
        '<div class="job-modal-field"><label for="act-title">Title</label>' +
          '<input id="act-title" type="text" maxlength="200" placeholder="e.g. Contract signing, Send quote, Meet insurance adjuster" value="' + esc(a.title) + '"></div>' +
        '<div class="job-modal-grid activity-when-grid">' +
          '<div class="job-modal-field"><label for="act-date">Date</label><input id="act-date" type="date" value="' + esc(a.activity_date) + '"></div>' +
          '<div class="job-modal-field"><label for="act-start">Start time <span class="field-optional">(optional)</span></label><input id="act-start" type="time" value="' + esc(a.start_time || '') + '"></div>' +
          '<div class="job-modal-field"><label for="act-end">End time <span class="field-optional">(optional)</span></label><input id="act-end" type="time" value="' + esc(a.end_time || '') + '"></div>' +
        '</div>' +
        '<div class="job-modal-field"><label for="act-notes">Notes</label>' +
          '<textarea id="act-notes" rows="3" maxlength="5000" placeholder="Address, who to meet, what to bring…">' + esc(a.notes) + '</textarea></div>' +
        '<label class="activity-done-toggle"><input type="checkbox" id="act-done"' + (a.status === 'completed' ? ' checked' : '') + '> Completed</label>' +
        (opts.links && existing
          ? '<div class="activity-links"><a href="/main?client=' + a.client_id + '">Open client</a>' +
            (a.job_id ? ' · <a href="/main?job=' + a.job_id + '">Open job</a>' : '') + '</div>'
          : '') +
        '<p class="field-hint activity-error" id="act-error" role="alert" hidden></p>' +
        '<div class="job-modal-actions">' +
          '<button type="button" class="btn-primary" data-act="save">' + (creating ? 'Add Activity' : 'Save') + '</button>' +
          (existing && a.status !== 'completed' ? '<button type="button" class="btn-primary btn-quiet" data-act="complete">Mark completed</button>' : '') +
          '<button type="button" class="btn-primary btn-quiet" data-act="close">Cancel</button>' +
          (existing && admin ? '<button type="button" class="btn-primary btn-danger-soft" data-act="delete">Delete</button>' : '') +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    var $ = function (sel) { return modal.querySelector(sel); };
    var jobSelect = $('#act-job');
    var errorEl = $('#act-error');

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = !message;
    }

    function currentClientId() {
      return pickClient ? Number($('#act-client').value) || null : a.client_id;
    }

    // Fills the job list with the chosen client's jobs (labels use the
    // business's own status names).
    async function loadJobs() {
      var clientId = currentClientId();
      var keep = jobSelect.value || (a.job_id ? String(a.job_id) : '');
      jobSelect.innerHTML = '<option value="">No job — client only</option>';
      if (!clientId) return;
      try {
        var data = await request('GET', '/api/jobs/client/' + clientId);
        var label = window.crmJobStatuses ? window.crmJobStatuses.label : function (s) { return s; };
        (data.jobs || []).forEach(function (j) {
          var o = document.createElement('option');
          o.value = String(j.id);
          o.textContent = (j.title || 'Untitled job') + (j.status ? ' (' + label(j.status) + ')' : '');
          jobSelect.appendChild(o);
        });
      } catch (e) {
        if (a.job_id && a.job_title) {
          var o = document.createElement('option');
          o.value = String(a.job_id);
          o.textContent = a.job_title;
          jobSelect.appendChild(o);
        }
      }
      if (keep && jobSelect.querySelector('option[value="' + keep + '"]')) jobSelect.value = keep;
    }
    if (pickClient) $('#act-client').addEventListener('change', function () { jobSelect.value = ''; loadJobs(); });
    loadJobs();

    function collect() {
      var start = $('#act-start').value;
      var end = $('#act-end').value;
      var payload = {
        title: $('#act-title').value.trim(),
        notes: $('#act-notes').value,
        activity_date: $('#act-date').value,
        start_time: start || null,
        end_time: end || null,
        job_id: jobSelect.value ? Number(jobSelect.value) : null,
        status: $('#act-done').checked ? 'completed' : 'pending'
      };
      if (creating) payload.client_id = currentClientId();
      if (creating && !payload.client_id) return { error: 'Choose a client.' };
      if (!payload.title) return { error: 'Give the activity a title.' };
      if (!payload.activity_date) return { error: 'Choose a date.' };
      if (end && !start) return { error: 'Add a start time, or clear the end time.' };
      if (start && end && end <= start) return { error: 'The end time must be later than the start time.' };
      return { payload: payload };
    }

    function close() {
      modal.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });

    async function run(button, work) {
      showError('');
      var buttons = modal.querySelectorAll('[data-act]');
      buttons.forEach(function (b) { b.disabled = true; });
      try {
        var result = await work();
        close();
        if (opts.onChange) opts.onChange(result);
      } catch (err) {
        showError(err.message || 'Something went wrong — nothing was saved.');
        buttons.forEach(function (b) { b.disabled = false; });
      }
    }

    modal.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      var act = btn.dataset.act;
      if (act === 'close') return close();
      if (act === 'save') {
        var c = collect();
        if (c.error) return showError(c.error);
        return run(btn, function () {
          return creating ? api.create(c.payload) : api.update(a.id, c.payload);
        });
      }
      if (act === 'complete') {
        return run(btn, function () { return api.update(a.id, { status: 'completed' }); });
      }
      if (act === 'delete') {
        if (!window.confirm('Delete this activity permanently?')) return;
        return run(btn, function () { return api.remove(a.id); });
      }
    });

    setTimeout(function () { ($('#act-title') || {}).focus && $('#act-title').focus(); }, 30);
    return modal;
  }

  // A client page / job section: header, list and "+ Activity".
  // opts: { clientId, clientName, jobId, title, emptyText }
  function mountSection(container, opts) {
    var state = { activities: [] };
    container.innerHTML =
      '<div class="activity-section-list"><div class="field-hint">Loading activities…</div></div>' +
      '<button type="button" class="btn-primary btn-quiet activity-add-btn">+ Activity</button>';
    var listEl = container.querySelector('.activity-section-list');
    var addBtn = container.querySelector('.activity-add-btn');

    async function load() {
      try {
        var data = opts.jobId ? await api.listForJob(opts.jobId) : await api.listForClient(opts.clientId);
        if (data.supported === false) {
          listEl.innerHTML = '<div class="field-hint">' + esc(data.message || 'Activities are not available yet.') + '</div>';
          addBtn.hidden = true;
          return;
        }
        state.activities = data.activities || [];
        renderList(listEl, state.activities, {
          emptyText: opts.emptyText,
          showJob: !opts.jobId,
          onOpen: function (activity) {
            openEditor({ activity: activity, onChange: load });
          }
        });
        if (opts.onLoaded) opts.onLoaded(state.activities);
      } catch (err) {
        listEl.innerHTML = '<div class="field-hint" style="color:var(--danger-text);">Could not load activities.</div>';
      }
    }
    addBtn.addEventListener('click', function () {
      openEditor({ clientId: opts.clientId, clientName: opts.clientName, jobId: opts.jobId, onChange: load });
    });
    load();
    return { reload: load };
  }

  window.CrmActivities = {
    api: api,
    formatTime: formatTime,
    formatDate: formatDate,
    timeText: timeText,
    today: today,
    renderList: renderList,
    openEditor: openEditor,
    mountSection: mountSection
  };
})();
