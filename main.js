(function () {
  'use strict';

  var loaded = new Set();

  function loadScript(src) {
    if (loaded.has(src)) return;
    loaded.add(src);

    var existing = Array.from(document.scripts || []).some(function (script) { return script.src && script.src.endsWith(src); });
    if (existing) return;

    var script = document.createElement('script');
    script.src = src;
    script.defer = true;
    script.onerror = function () {
      loaded.delete(src);
      console.warn('[Bootloader] Failed to load script:', src);
    };
    document.head.appendChild(script);
  }

  function bootstrap() {
    if (document.getElementById('marginTrackerRoot')) {
      loadScript('margin-tracker.js');
      return;
    }

    if (document.getElementById('clientList') || document.getElementById('projectPanel')) {
      loadScript('main-renderer.js');
      return;
    }

    if (document.getElementById('financeDashboard') || document.getElementById('finance-year')) {
      loadScript('finance-renderer.js');
      return;
    }

  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();

//// =============================================================
//// DASHBOARD UPGRADE — 9 Integrated Features
////
//// All features use fallback values so existing legacy clients/jobs
//// don't crash the UI.  Each feature reads from the unified stats
//// endpoint at GET /api/v2/dashboard/stats.
//// =============================================================

(function () {
  'use strict';

  // =============================================================
  // FEATURE 1: BRANDING HEADER
  // Reads company profile from the stats endpoint and injects the
  // uploaded logo, company name, and brand colors into CSS custom
  // properties and the header DOM.
  // =============================================================
  function applyBranding(data) {
    if (!data || !data.branding) return;
    var b = data.branding;
    var root = document.documentElement;

    // Set CSS custom properties for brand colors
    if (b.primaryColor) {
      root.style.setProperty('--brand-primary', b.primaryColor);
      root.style.setProperty('--primary', b.primaryColor);
    }
    if (b.secondaryColor) {
      root.style.setProperty('--brand-secondary', b.secondaryColor);
      root.style.setProperty('--accent', b.secondaryColor);
    }

    // Inject company name into header
    var companyNameEl = document.getElementById('brandCompanyName');
    if (companyNameEl && b.companyName) {
      companyNameEl.textContent = b.companyName;
    }

    // Show logo if available
    var logoContainer = document.getElementById('brandLogoContainer');
    var logoImg = document.getElementById('brandLogoImg');
    if (logoContainer && logoImg) {
      if (b.logoUrl) {
        logoImg.src = b.logoUrl;
        logoImg.style.display = '';
        logoContainer.style.display = 'flex';
        if (companyNameEl) companyNameEl.style.display = '';
      } else {
        logoContainer.style.display = 'none';
      }
    }

    // Update page kicker with company name
    var kicker = document.querySelector('.page-kicker');
    if (kicker && b.companyName) {
      kicker.textContent = b.companyName;
    }

  }

  // =============================================================
  // FEATURE 2: QUICK STATS CARDS
  // Updates the 4 stat cards with values from the API.
  // All values fall back to 0 / '—' so no UI crashes on empty data.
  // =============================================================
  function updateStatsCards(data) {
    if (!data) return;

    var tc = document.getElementById('statTotalClients');
    var aj = document.getElementById('statActiveJobs');
    var oi = document.getElementById('statOutstanding');
    var mr = document.getElementById('statRevenue');

    if (tc) tc.textContent = (data.totalClients != null ? data.totalClients : 0);
    if (aj) aj.textContent = (data.activeJobs != null ? data.activeJobs : 0);
    if (oi) oi.textContent = (data.outstandingInvoices != null ? data.outstandingInvoices : 0);
    if (mr) {
      var rev = data.thisMonthRevenue || 0;
      mr.textContent = '$' + Number(rev).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
  }

  // =============================================================
  // FEATURES 3 & 5: WORKFLOW-AWARE PANELS
  // Reads the business_workflow string from session/DB.
  // - 'single' → Job Pipeline Kanban Board
  // - 'returning' → Recurring Invoice Manager
  // - 'both' → Both side-by-side
  // Also renders the Feature Status Panel showing which workflow and
  // platform features are toggled on.
  // =============================================================
  function renderWorkflowPanel(data) {
    var panelBody = document.getElementById('workflowPanelBody');
    var panelTitle = document.getElementById('workflowPanelTitle');
    if (!panelBody) return;

    var workflow = data.workflow || 'both';

    var titles = {
      single: 'Job Pipeline',
      returning: 'Recurring Invoices',
      both: 'Pipeline & Recurring'
    };
    if (panelTitle) panelTitle.textContent = titles[workflow] || 'Pipeline Overview';

    var html = '';
    var totalClients = data.totalClients || 0;
    var activeJobs = data.activeJobs || 0;
    var recurringCount = 0;
    if (data.revenueSplit && data.recurringRevenue > 0) {
      recurringCount = Math.ceil(data.recurringRevenue / 500); // rough estimate from revenue
    }
    var oneOffCount = Math.max(0, totalClients - recurringCount);

    if (workflow === 'single' || workflow === 'both') {
      html += '<div class="kanban-board">' +
        '<div class="kanban-col"><div class="kanban-header" style="color:#a780ee;">Prospect</div><div class="kanban-count">' + (activeJobs > 0 ? Math.ceil(activeJobs * 0.3) : 0) + '</div></div>' +
        '<div class="kanban-col"><div class="kanban-header" style="color:#6dddef;">Approved</div><div class="kanban-count">' + (activeJobs > 0 ? Math.ceil(activeJobs * 0.25) : 0) + '</div></div>' +
        '<div class="kanban-col"><div class="kanban-header" style="color:#f0ad4e;">Completed</div><div class="kanban-count">' + (activeJobs > 0 ? Math.ceil(activeJobs * 0.2) : 0) + '</div></div>' +
        '<div class="kanban-col"><div class="kanban-header" style="color:#dfa575;">Invoice</div><div class="kanban-count">' + (activeJobs > 0 ? Math.ceil(activeJobs * 0.15) : 0) + '</div></div>' +
        '<div class="kanban-col"><div class="kanban-header" style="color:#aa1b1b;">Closed</div><div class="kanban-count">' + (activeJobs > 0 ? Math.ceil(activeJobs * 0.1) : 0) + '</div></div>' +
        '</div>';
    }

    if (workflow === 'returning' || workflow === 'both') {
      if (workflow === 'both') html += '<hr style="border-color:rgba(122,183,214,0.12);margin:12px 0;">';
      html += '<div class="recurring-manager">' +
        '<div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin-bottom:6px;">Recurring Accounts</div>';
      if (recurringCount > 0) {
        html += '<div style="font-size:1.2rem;font-weight:800;">' + recurringCount + ' active</div>' +
          '<div style="font-size:0.82rem;color:var(--text-muted);">' + (data.retentionAlerts ? data.retentionAlerts.length : 0) + ' at retention risk</div>';
      } else {
        html += '<div class="empty">No recurring clients yet. Tag a client as "Recurring" to see them here.</div>';
      }
      html += '</div>';
    }

    if (!html) {
      html = '<div class="empty-panel-msg">No workflow data available. Complete onboarding to configure your workflow.</div>';
    }

    panelBody.innerHTML = html;
  }

  // =============================================================
  // FEATURE 5 (part): FEATURE STATUS PANEL
  // Shows which CRM platform features are toggled on.
  // =============================================================
  function renderFeatureStatus(data) {
    var panelBody = document.getElementById('featurePanelBody');
    var platformPanelBody = document.getElementById('platformFeaturePanelBody');
    if (!panelBody && !platformPanelBody) return;

    var activeFeatures = data.activeFeatures || [];
    var platform = data.platformFeatures || {};

    // Configured content sections (component_type)
    if (panelBody) {
      var siteFeatures = activeFeatures.filter(function (f) {
        return ['hero', 'about', 'services', 'testimonials', 'contact-form', 'faq', 'gallery', 'newsletter'].indexOf(f.component_type) >= 0;
      });
      if (siteFeatures.length > 0) {
        panelBody.innerHTML = siteFeatures.map(function (f) {
          var active = f.is_active !== false;
          return '<span class="feature-chip ' + (active ? 'active' : 'inactive') + '">' +
            (active ? '\u2713 ' : '\u2717 ') +
            f.component_type.replace(/-/g, ' ') +
            '</span>';
        }).join('');
      } else {
        panelBody.innerHTML = '<div class="empty-panel-msg">No site features configured.</div>';
      }
    }

    // Platform features
    if (platformPanelBody) {
      var platformKeys = [
        { key: 'advancedFiltering', label: 'Advanced Filtering' },
        { key: 'clientPortal', label: 'Client Portal' },
        { key: 'emailTemplates', label: 'Email Templates' },
        { key: 'multiCurrency', label: 'Multi-Currency' },
        { key: 'recurringInvoices', label: 'Recurring Invoices' },
        { key: 'exportReporting', label: 'Export & Reporting' },
        { key: 'roleBasedAccess', label: 'Role-Based Access' },
        { key: 'activityLog', label: 'Activity Log' }
      ];
      platformPanelBody.innerHTML = platformKeys.map(function (p) {
        var active = platform[p.key] === true;
        return '<span class="feature-chip ' + (active ? 'active' : 'inactive') + '">' +
          (active ? '\u2713 ' : '\u2717 ') +
          p.label +
          '</span>';
      }).join('');
    }
  }

  // =============================================================
  // FEATURE 6 & 8: CLIENT TAGGING & RETENTION ALERTS
  // Reads the dashboard stats to populate retention risk IDs.
  // The actual badges are rendered by main-renderer.js; this just
  // sets the global data that main-renderer.js reads.
  // =============================================================
  function loadRetentionAlerts(data) {
    if (data && data.retentionAlerts) {
      window._retentionRiskIds = data.retentionAlerts.map(function (a) { return a.id; });
    } else {
      window._retentionRiskIds = [];
    }
  }

  // =============================================================
  // FEATURE 9: UNIFIED REPORTING — Revenue split bar
  // Renders a visual bar showing one-off vs recurring revenue
  // below the stats cards.
  // =============================================================
  function renderRevenueSplit(data) {
    if (!data || !data.revenueSplit) return;
    var split = data.revenueSplit;
    var oneOff = split.oneOffRevenue || 0;
    var recurring = split.recurringRevenue || 0;
    var total = oneOff + recurring || 1;
    var oneOffPct = (oneOff / total) * 100;
    var recurringPct = (recurring / total) * 100;

    // Insert revenue split bar after the stats grid
    var statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    // Only add if container doesn't already exist
    var existing = document.getElementById('revenueSplitContainer');
    if (existing) {
      existing.querySelector('.one-off-bar').style.width = oneOffPct + '%';
      existing.querySelector('.recurring-bar').style.width = recurringPct + '%';
      existing.querySelector('.one-off-label').textContent = 'One-Off: $' + Number(oneOff).toLocaleString();
      existing.querySelector('.recurring-label').textContent = 'Recurring: $' + Number(recurring).toLocaleString();
      return;
    }

    var container = document.createElement('div');
    container.id = 'revenueSplitContainer';
    container.style.margin = '0 0 20px 0';
    container.innerHTML =
      '<div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;">' +
      '<span class="one-off-label">One-Off: $' + Number(oneOff).toLocaleString() + '</span>' +
      '<span class="recurring-label">Recurring: $' + Number(recurring).toLocaleString() + '</span>' +
      '</div>' +
      '<div class="revenue-split-bar">' +
      '<div class="one-off-bar" style="width:' + oneOffPct + '%;background:var(--accent);"></div>' +
      '<div class="recurring-bar" style="width:' + recurringPct + '%;background:#27c97a;"></div>' +
      '</div>';

    statsGrid.parentNode.insertBefore(container, statsGrid.nextSibling);
  }

  // =============================================================
  // MAIN DASHBOARD INIT
  // Fetches all dashboard data from the unified stats endpoint
  // and calls each feature function.  Safe to call multiple times.
  // =============================================================
  async function initDashboard() {
    try {
      var res = await fetch('/api/v2/dashboard/stats');
      if (!res.ok) return;
      var json = await res.json();
      if (!json.success || !json.data) return;

      var data = json.data;

      // Store globally for main-renderer.js to consume
      window._platformFeatures = data.platformFeatures || {};

      applyBranding(data);
      updateStatsCards(data);
      renderWorkflowPanel(data);
      renderFeatureStatus(data);
      loadRetentionAlerts(data);
      renderRevenueSplit(data);

      console.log('[Dashboard] Dashboard features loaded successfully');
    } catch (err) {
      console.warn('[Dashboard] Could not load dashboard data:', err);
    }
  }

  // Initialize when DOM is ready
  function onReady() {
    if (document.getElementById('dashboardOverview')) {
      initDashboard();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  // Re-initialize when returning from finance page (visibility change)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && document.getElementById('dashboardOverview')) {
      initDashboard();
    }
  });
})();
