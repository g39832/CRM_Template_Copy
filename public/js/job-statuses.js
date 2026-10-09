// Job status names for every page (window.crmJobStatuses).
//
// Jobs store a fixed status id (Prospect, Approved, Completed, Invoice,
// Closed, Cancelled); admins can rename what each one is CALLED in
// Settings → Job Statuses. Pages show label(id) wherever a status is shown
// and always send the id back, so renaming never changes how a job behaves
// (Finance still counts Approved/Completed/Invoice/Closed, the Calendar still
// schedules Approved). The defaults below are used until /api/job-statuses
// answers, so nothing waits on it.
(function () {
  var DEFAULTS = [
    { id: 'Prospect', label: 'Prospect', countsInFinance: false },
    { id: 'Approved', label: 'Approved', countsInFinance: true },
    { id: 'Completed', label: 'Completed', countsInFinance: true },
    { id: 'Invoice', label: 'Invoice', countsInFinance: true },
    { id: 'Closed', label: 'Closed', countsInFinance: true },
    { id: 'Cancelled', label: 'Cancelled', countsInFinance: false }
  ];
  var list = DEFAULTS.slice();
  var listeners = [];

  function find(id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  var api = {
    list: function () { return list.slice(); },
    ids: function () { return list.map(function (s) { return s.id; }); },
    // The name to show for a stored status id (unknown ids show as stored).
    label: function (id) {
      var s = find(id);
      return s ? s.label : String(id || '');
    },
    countsInFinance: function (id) {
      var s = find(id);
      return Boolean(s && s.countsInFinance);
    },
    // Calls fn now and again whenever the names are (re)loaded.
    onChange: function (fn) {
      listeners.push(fn);
    },
    set: function (statuses) {
      if (!Array.isArray(statuses) || !statuses.length) return;
      list = statuses.map(function (s) {
        return { id: s.id, label: s.label || s.id, countsInFinance: Boolean(s.countsInFinance), meaning: s.meaning || '', defaultLabel: s.defaultLabel || s.id };
      });
      listeners.forEach(function (fn) { try { fn(api); } catch (e) { console.error(e); } });
    },
    reload: function () {
      return fetch('/api/job-statuses', { credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { if (data && data.statuses) api.set(data.statuses); return api; })
        .catch(function () { return api; });
    }
  };
  api.ready = api.reload();
  window.crmJobStatuses = api;
})();
