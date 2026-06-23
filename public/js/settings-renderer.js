(function () {
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/`/g, '&#96;');
  }

  var API = '/api/v2/admin/settings';
  var feedback = document.getElementById('formFeedback');
  var loadingOverlay = document.getElementById('loadingOverlay');

  // Feature descriptions
  var DESCRIPTIONS = {
    hero: 'Large headline section with call-to-action button',
    about: 'Your company description and story',
    services: 'Grid of service offerings with descriptions',
    testimonials: 'Client testimonials with quotes',
    'contact-form': 'Contact form that emails your company inbox',
    faq: 'Expandable frequently asked questions',
    gallery: 'Photo grid showcasing your work',
    newsletter: 'Email signup form for updates',
    'advanced-filtering': 'Advanced search and filter capabilities for client records',
    'client-portal': 'Self-service portal where clients can view invoices and jobs',
    'email-templates': 'Customizable email templates for client communications',
    'multi-currency': 'Support for multiple currencies across invoices and reporting',
    'recurring-invoices': 'Automated recurring invoice generation for retainer clients',
    'export-reporting': 'Export data to CSV, PDF and generate custom reports',
    'role-based-access': 'Granular permissions for team members and roles',
    'activity-log': 'Audit trail of all changes made across the system'
  };

  var features = [];

  // ==================== TABS ====================
  var tabBtns = document.querySelectorAll('.tab-btn');
  var tabPanels = {
    user: document.getElementById('tabUser'),
    features: document.getElementById('tabFeatures'),
    branding: document.getElementById('tabBranding'),
    users: document.getElementById('tabUsers'),
    audit: document.getElementById('tabAudit'),
    workflow: document.getElementById('tabWorkflow')
  };

  tabBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = this.getAttribute('data-tab');
      tabBtns.forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      Object.keys(tabPanels).forEach(function (key) {
        tabPanels[key].classList.toggle('active', key === tab);
      });
      if (tab === 'users') loadUsers();
      if (tab === 'audit') { loadAuditLog(); loadAuditActions(); }
    });
  });

  // ==================== LOAD DATA ====================
  function loadData() {
    showLoading(true);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', API, true);
    xhr.onload = function () {
      showLoading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        var resp = JSON.parse(xhr.responseText);
        if (resp.success && resp.data) {
          populateForm(resp.data);
        } else {
          showError(resp.error || 'Failed to load settings');
        }
      } else {
        showError('Failed to load settings (status ' + xhr.status + ')');
      }
    };
    xhr.onerror = function () {
      showLoading(false);
      showError('Network error loading settings');
    };
    xhr.send();
  }

  // ==================== POPULATE FORM ====================
  function populateForm(data) {
    var company = data.company || {};
    features = data.features || [];
    renderFeatures();

    // Branding tab
    var nameEl = document.getElementById('companyName');
    if (nameEl) nameEl.value = company.name || '';

    var taglineEl = document.getElementById('tagline');
    if (taglineEl) taglineEl.value = company.tagline || '';

    var descEl = document.getElementById('description');
    if (descEl) descEl.value = company.description || '';

    var emailEl = document.getElementById('contactEmail');
    if (emailEl) emailEl.value = company.contact_email || '';

    var primaryEl = document.getElementById('primaryColor');
    if (primaryEl) primaryEl.value = company.brand_primary_color || '#2563eb';

    var secondaryEl = document.getElementById('secondaryColor');
    if (secondaryEl) secondaryEl.value = company.brand_secondary_color || '#1c92d2';

    var previewEl = document.getElementById('logoPreview');
    if (previewEl && company.logo_url) {
      previewEl.src = company.logo_url;
      previewEl.classList.add('visible');
    }

    // Workflow tab
    var wfEl = document.getElementById('workflowSelect');
    if (wfEl) wfEl.value = company.business_workflow || 'both';
  }

  // ==================== FEATURES RENDER ====================
  function renderFeatures() {
    var list = document.getElementById('featureList');
    if (!list) return;

    var html = '';
    features.forEach(function (f, i) {
      var type = f.component_type || 'unknown';
      var active = f.is_active !== false;
      var desc = DESCRIPTIONS[type] || '';
      var first = i === 0;
      var last = i === features.length - 1;

      html += '<div class="feature-item' + (active ? '' : ' inactive') + '">' +
        '<div class="feature-order">' +
          '<button type="button" class="order-up" data-idx="' + i + '"' + (first ? ' disabled' : '') + '>&#9650;</button>' +
          '<button type="button" class="order-down" data-idx="' + i + '"' + (last ? ' disabled' : '') + '>&#9660;</button>' +
        '</div>' +
        '<div class="feature-toggle">' +
          '<input type="checkbox" id="ftoggle-' + i + '"' + (active ? ' checked' : '') + ' data-idx="' + i + '">' +
          '<label for="ftoggle-' + i + '"></label>' +
        '</div>' +
        '<div class="feature-info">' +
          '<div class="name">' + type.replace(/-/g, ' ') + '</div>' +
          '<div class="desc">' + desc + '</div>' +
        '</div>' +
      '</div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.order-up').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-idx'));
        if (idx <= 0) return;
        swap(idx, idx - 1);
      });
    });
    list.querySelectorAll('.order-down').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-idx'));
        if (idx >= features.length - 1) return;
        swap(idx, idx + 1);
      });
    });
    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var idx = parseInt(this.getAttribute('data-idx'));
        features[idx].is_active = this.checked;
        var item = this.closest('.feature-item');
        if (item) item.classList.toggle('inactive', !this.checked);
      });
    });
  }

  function swap(a, b) {
    var tmp = features[a];
    features[a] = features[b];
    features[b] = tmp;
    features.forEach(function (f, i) { f.display_order = i; });
    renderFeatures();
  }

  // ==================== SAVE FEATURES ====================
  document.getElementById('saveFeaturesBtn').addEventListener('click', function () {
    var payload = features.map(function (f, i) {
      return {
        component_type: f.component_type,
        is_active: f.is_active !== false,
        display_order: i,
        config: f.config || {}
      };
    });
    saveSettings({ features: payload }, 'Features saved');
  });

  // ==================== SAVE BRANDING ====================
  document.getElementById('saveBrandingBtn').addEventListener('click', function () {
    var formData = new FormData();

    var payload = {
      name: document.getElementById('companyName').value.trim(),
      tagline: document.getElementById('tagline').value.trim(),
      description: document.getElementById('description').value.trim(),
      contactEmail: document.getElementById('contactEmail').value.trim(),
      primaryColor: document.getElementById('primaryColor').value,
      secondaryColor: document.getElementById('secondaryColor').value
    };

    formData.append('company', JSON.stringify(payload));

    var logoFile = document.getElementById('logoUpload').files[0];
    if (logoFile) formData.append('logo', logoFile);

    saveSettingsMultipart(formData, 'Branding saved');
  });

  // ==================== SAVE WORKFLOW ====================
  document.getElementById('saveWorkflowBtn').addEventListener('click', function () {
    var workflow = document.getElementById('workflowSelect').value;
    saveSettings({ company: { business_workflow: workflow } }, 'Preference saved');
  });

  // ==================== API HELPERS ====================
  function saveSettings(body, successMsg) {
    showLoading(true);
    hideFeedback();
    var xhr = new XMLHttpRequest();
    xhr.open('PATCH', API, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      showLoading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = JSON.parse(xhr.responseText);
        if (data.success) {
          showSuccess(successMsg);
          // Reload data to reflect changes
          setTimeout(loadData, 1500);
        } else {
          showError(data.error || 'Failed to save');
        }
      } else {
        showError('Failed to save (status ' + xhr.status + ')');
        // Try to parse error from response
        try {
          var errData = JSON.parse(xhr.responseText);
          if (errData.error) showError(errData.error);
        } catch (_) {}
      }
    };
    xhr.onerror = function () {
      showLoading(false);
      showError('Network error');
    };
    xhr.send(JSON.stringify(body));
  }

  function saveSettingsMultipart(formData, successMsg) {
    showLoading(true);
    hideFeedback();
    var xhr = new XMLHttpRequest();
    xhr.open('PATCH', API, true);
    xhr.onload = function () {
      showLoading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        var data = JSON.parse(xhr.responseText);
        if (data.success) {
          showSuccess(successMsg);
          setTimeout(loadData, 1500);
        } else {
          showError(data.error || 'Failed to save');
        }
      } else {
        showError('Failed to save (status ' + xhr.status + ')');
        try {
          var errData = JSON.parse(xhr.responseText);
          if (errData.error) showError(errData.error);
        } catch (_) {}
      }
    };
    xhr.onerror = function () {
      showLoading(false);
      showError('Network error');
    };
    xhr.send(formData);
  }

  // ==================== HELPERS ====================
  function showLoading(visible) {
    if (loadingOverlay) loadingOverlay.classList.toggle('visible', visible);
  }

  function showError(msg) {
    if (!feedback) return;
    feedback.className = 'error';
    feedback.textContent = msg;
  }

  function showSuccess(msg) {
    if (!feedback) return;
    feedback.className = 'success';
    feedback.textContent = msg;
  }

  function hideFeedback() {
    if (!feedback) return;
    feedback.className = '';
    feedback.textContent = '';
  }

  // Logo preview
  var logoUpload = document.getElementById('logoUpload');
  var logoPreview = document.getElementById('logoPreview');
  if (logoUpload && logoPreview) {
    logoUpload.addEventListener('change', function () {
      var file = this.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function (e) {
          logoPreview.src = e.target.result;
          logoPreview.classList.add('visible');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // ==================== USER MANAGEMENT ====================
  var USERS_API = '/api/v2/admin/users';
  var RESET_API = '/api/v2/admin/reset-demo';

  function loadUsers() {
    var tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#64748b;">Loading users...</td></tr>';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', USERS_API, true);
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        var resp = JSON.parse(xhr.responseText);
        var users = resp.data || [];
        if (users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#64748b;">No users found.</td></tr>';
          return;
        }
        var html = '';
        users.forEach(function (u) {
          var created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
          var roleBadge = u.role === 'admin'
            ? '<span style="background:rgba(37,99,235,0.2);color:#60a5fa;padding:2px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">Admin</span>'
            : '<span style="background:rgba(255,255,255,0.06);color:#94a3b8;padding:2px 10px;border-radius:999px;font-size:0.78rem;font-weight:600;">User</span>';
          html += '<tr style="border-bottom:1px solid rgba(122,183,214,0.08);">' +
            '<td style="padding:10px 8px;">' + escapeHtml(u.display_name || '—') + '</td>' +
            '<td style="padding:10px 8px;color:#94a3b8;">' + escapeHtml(u.email) + '</td>' +
            '<td style="padding:10px 8px;">' + roleBadge + '</td>' +
            '<td style="padding:10px 8px;color:#94a3b8;font-size:0.82rem;">' + created + '</td>' +
            '<td style="padding:10px 8px;text-align:center;">';
          if (u.role !== 'admin') {
            html += '<button type="button" class="delete-user-btn" data-id="' + u.id + '" data-email="' + escapeHtml(u.email) + '" style="background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.78rem;">Delete</button>';
          } else {
            html += '<span style="color:#64748b;font-size:0.78rem;">—</span>';
          }
          html += '</td></tr>';
        });
        tbody.innerHTML = html;

        tbody.querySelectorAll('.delete-user-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var email = this.getAttribute('data-email');
            if (!confirm('Delete user "' + email + '" permanently?')) return;
            var delXhr = new XMLHttpRequest();
            delXhr.open('DELETE', USERS_API + '/' + id, true);
            delXhr.onload = function () {
              if (delXhr.status >= 200 && delXhr.status < 300) {
                showSuccess('User deleted');
                loadUsers();
              } else {
                try {
                  var errResp = JSON.parse(delXhr.responseText);
                  showError(errResp.error || 'Failed to delete user');
                } catch (_) {
                  showError('Failed to delete user');
                }
              }
            };
            delXhr.send();
          });
        });
      } else {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#fca5a5;">Failed to load users.</td></tr>';
      }
    };
    xhr.onerror = function () {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:#fca5a5;">Network error loading users.</td></tr>';
    };
    xhr.send();
  }

  // Add User modal
  var addUserBtn = document.getElementById('addUserBtn');
  var addUserModal = document.getElementById('addUserModal');
  var cancelAddUser = document.getElementById('cancelAddUser');
  var saveNewUser = document.getElementById('saveNewUser');

  if (addUserBtn && addUserModal) {
    addUserBtn.addEventListener('click', function () {
      addUserModal.style.display = 'flex';
      var feedback = document.getElementById('addUserFeedback');
      if (feedback) { feedback.style.display = 'none'; feedback.textContent = ''; }
    });

    if (cancelAddUser) {
      cancelAddUser.addEventListener('click', function () {
        addUserModal.style.display = 'none';
      });
    }

    addUserModal.addEventListener('click', function (e) {
      if (e.target === addUserModal) addUserModal.style.display = 'none';
    });

    if (saveNewUser) {
      saveNewUser.addEventListener('click', function () {
        var email = document.getElementById('newUserEmail');
        var displayName = document.getElementById('newUserDisplayName');
        var password = document.getElementById('newUserPassword');
        var role = document.getElementById('newUserRole');
        var feedback = document.getElementById('addUserFeedback');

        if (!email || !email.value.trim()) {
          if (feedback) { feedback.style.display = 'block'; feedback.className = 'error'; feedback.textContent = 'Email is required'; }
          return;
        }
        if (!password || !password.value.trim() || password.value.length < 6) {
          if (feedback) { feedback.style.display = 'block'; feedback.className = 'error'; feedback.textContent = 'Password must be at least 6 characters'; }
          return;
        }

        var payload = {
          email: email.value.trim(),
          displayName: displayName ? displayName.value.trim() : '',
          password: password.value,
          role: role ? role.value : 'user'
        };

        var xhr = new XMLHttpRequest();
        xhr.open('POST', USERS_API, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (feedback) { feedback.style.display = 'block'; feedback.className = 'success'; feedback.textContent = 'User created successfully'; }
            if (email) email.value = '';
            if (displayName) displayName.value = '';
            if (password) password.value = '';
            setTimeout(function () {
              addUserModal.style.display = 'none';
              loadUsers();
            }, 1000);
          } else {
            try {
              var errResp = JSON.parse(xhr.responseText);
              if (feedback) { feedback.style.display = 'block'; feedback.className = 'error'; feedback.textContent = errResp.error || 'Failed to create user'; }
            } catch (_) {
              if (feedback) { feedback.style.display = 'block'; feedback.className = 'error'; feedback.textContent = 'Failed to create user'; }
            }
          }
        };
        xhr.onerror = function () {
          if (feedback) { feedback.style.display = 'block'; feedback.className = 'error'; feedback.textContent = 'Network error'; }
        };
        xhr.send(JSON.stringify(payload));
      });
    }
  }

  var resetDemoBtn = document.getElementById('resetDemoBtn');
  if (resetDemoBtn) {
    resetDemoBtn.addEventListener('click', function () {
      var confirmText = window.prompt('Type RESET DEMO to clear the demo state and return to first-run setup.');
      if (!confirmText) return;
      if (confirmText.trim().toUpperCase() !== 'RESET DEMO') {
        showError('Reset cancelled. You must type RESET DEMO exactly.');
        return;
      }

      if (!window.confirm('This will delete the current onboarding data and log you out. Continue?')) {
        return;
      }

      showLoading(true);
      hideFeedback();

      var xhr = new XMLHttpRequest();
      xhr.open('POST', RESET_API, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        showLoading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var resp = JSON.parse(xhr.responseText);
            if (resp.success) {
              window.location.href = '/login-v2?setup=1&reset=1';
              return;
            }
            showError(resp.error || 'Failed to reset demo state');
          } catch (_) {
            window.location.href = '/login-v2?setup=1&reset=1';
          }
        } else {
          try {
            var errResp = JSON.parse(xhr.responseText);
            showError(errResp.error || 'Failed to reset demo state');
          } catch (_) {
            showError('Failed to reset demo state');
          }
        }
      };
      xhr.onerror = function () {
        showLoading(false);
        showError('Network error resetting demo state');
      };
      xhr.send(JSON.stringify({ confirm: 'reset demo' }));
    });
  }

  // ==================== AUDIT LOG ====================
  var AUDIT_API = '/api/v2/admin/activity-log';
  var auditPage = 1;
  var auditActionFilter = '';
  var auditEntityFilter = '';

  function loadAuditLog() {
    var tbody = document.getElementById('auditTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#64748b;">Loading activity log...</td></tr>';

    var params = '?page=' + auditPage + '&limit=20';
    if (auditActionFilter) params += '&action=' + encodeURIComponent(auditActionFilter);
    if (auditEntityFilter) params += '&entity_type=' + encodeURIComponent(auditEntityFilter);

    var xhr = new XMLHttpRequest();
    xhr.open('GET', AUDIT_API + params, true);
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        var resp = JSON.parse(xhr.responseText);
        var entries = resp.data || [];
        var total = resp.total || 0;
        var pageInfo = document.getElementById('auditPageInfo');
        var prevBtn = document.getElementById('auditPrevPage');
        var nextBtn = document.getElementById('auditNextPage');

        if (pageInfo) pageInfo.textContent = 'Page ' + auditPage + ' (' + total + ' total)';
        if (prevBtn) prevBtn.disabled = auditPage <= 1;
        if (nextBtn) nextBtn.disabled = auditPage * 20 >= total;

        if (entries.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#64748b;">No activity log entries found.</td></tr>';
          return;
        }

        var html = '';
        entries.forEach(function (entry) {
          var date = entry.created_at ? new Date(entry.created_at).toLocaleString() : '—';
          var details = '';
          if (entry.details) {
            try {
              var detailObj = typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details;
              details = Object.keys(detailObj).slice(0, 3).map(function (k) { return k + ': ' + String(detailObj[k]).slice(0, 40); }).join(', ');
            } catch (_) {
              details = String(entry.details).slice(0, 80);
            }
          }
          html += '<tr style="border-bottom:1px solid rgba(122,183,214,0.08);">' +
            '<td style="padding:8px;color:#94a3b8;font-size:0.8rem;white-space:nowrap;">' + escapeHtml(date) + '</td>' +
            '<td style="padding:8px;font-weight:600;">' + escapeHtml(entry.action || '—') + '</td>' +
            '<td style="padding:8px;color:#94a3b8;">' + escapeHtml(entry.entity_type || '—') + '</td>' +
            '<td style="padding:8px;color:#94a3b8;font-size:0.82rem;">' + escapeHtml(details) + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = html;
      } else {
        tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#fca5a5;">Failed to load activity log.</td></tr>';
      }
    };
    xhr.onerror = function () {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#fca5a5;">Network error.</td></tr>';
    };
    xhr.send();
  }

  function loadAuditActions() {
    var select = document.getElementById('auditActionFilter');
    if (!select) return;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', AUDIT_API + '/actions', true);
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var resp = JSON.parse(xhr.responseText);
          var actions = resp.data || [];
          var currentVal = select.value;
          select.innerHTML = '<option value="">All actions</option>';
          actions.forEach(function (a) {
            select.innerHTML += '<option value="' + escapeHtml(a) + '"' + (a === currentVal ? ' selected' : '') + '>' + escapeHtml(a) + '</option>';
          });
        } catch (_) {}
      }
    };
    xhr.send();
  }

  // Audit filter buttons
  var applyAuditFilter = document.getElementById('applyAuditFilter');
  var clearAuditFilter = document.getElementById('clearAuditFilter');
  var refreshAuditLog = document.getElementById('refreshAuditLog');
  var auditPrevPage = document.getElementById('auditPrevPage');
  var auditNextPage = document.getElementById('auditNextPage');

  if (applyAuditFilter) {
    applyAuditFilter.addEventListener('click', function () {
      var actionSelect = document.getElementById('auditActionFilter');
      var entitySelect = document.getElementById('auditEntityFilter');
      auditActionFilter = actionSelect ? actionSelect.value : '';
      auditEntityFilter = entitySelect ? entitySelect.value : '';
      auditPage = 1;
      loadAuditLog();
    });
  }

  if (clearAuditFilter) {
    clearAuditFilter.addEventListener('click', function () {
      var actionSelect = document.getElementById('auditActionFilter');
      var entitySelect = document.getElementById('auditEntityFilter');
      if (actionSelect) actionSelect.value = '';
      if (entitySelect) entitySelect.value = '';
      auditActionFilter = '';
      auditEntityFilter = '';
      auditPage = 1;
      loadAuditLog();
    });
  }

  if (refreshAuditLog) {
    refreshAuditLog.addEventListener('click', function () {
      loadAuditLog();
      loadAuditActions();
    });
  }

  if (auditPrevPage) {
    auditPrevPage.addEventListener('click', function () {
      if (auditPage > 1) { auditPage--; loadAuditLog(); }
    });
  }

  if (auditNextPage) {
    auditNextPage.addEventListener('click', function () {
      auditPage++; loadAuditLog();
    });
  }

  // ==================== USER SETTINGS ====================
  var saveUserSettingsBtn = document.getElementById('saveUserSettingsBtn');
  if (saveUserSettingsBtn) {
    saveUserSettingsBtn.addEventListener('click', function () {
      var displayName = document.getElementById('userDisplayName');
      var currentPassword = document.getElementById('currentPassword');
      var newPassword = document.getElementById('newPassword');
      var confirmPassword = document.getElementById('confirmPassword');

      var payload = {};
      if (displayName && displayName.value.trim()) {
        payload.displayName = displayName.value.trim();
      }
      if (currentPassword && currentPassword.value && newPassword && newPassword.value) {
        payload.currentPassword = currentPassword.value;
        payload.newPassword = newPassword.value;
        if (confirmPassword) payload.confirmPassword = confirmPassword.value;
      }
      if (!payload.displayName && !payload.currentPassword) {
        showError('Enter a display name or fill in the password fields to update.');
        return;
      }

      showLoading(true);
      hideFeedback();
      var xhr = new XMLHttpRequest();
      xhr.open('PATCH', '/api/v2/auth/me', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        showLoading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          var data = JSON.parse(xhr.responseText);
          if (data.success) {
            showSuccess('Settings saved');
            if (currentPassword) currentPassword.value = '';
            if (newPassword) newPassword.value = '';
            if (confirmPassword) confirmPassword.value = '';
          } else {
            showError(data.error || 'Failed to save settings');
          }
        } else {
          showError('Failed to save (status ' + xhr.status + ')');
          try {
            var errData = JSON.parse(xhr.responseText);
            if (errData.error) showError(errData.error);
          } catch (_) {}
        }
      };
      xhr.onerror = function () {
        showLoading(false);
        showError('Network error');
      };
      xhr.send(JSON.stringify(payload));
    });
  }

  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/api/v2/auth/logout', { method: 'POST' })
        .then(function () { window.location.href = '/login-v2'; })
        .catch(function () { window.location.href = '/login-v2'; });
    });
  }

  // Load user profile into the My Settings tab
  (function loadUserProfile() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/v2/auth/me', true);
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          var data = JSON.parse(xhr.responseText);
          if (data.authenticated && data.user) {
            var nameEl = document.getElementById('userDisplayName');
            var emailEl = document.getElementById('userEmail');
            var roleEl = document.getElementById('userRoleBadge');
            if (nameEl) nameEl.value = data.user.displayName || '';
            if (emailEl) emailEl.value = data.user.email || '';
            if (roleEl) roleEl.textContent = data.user.role === 'admin' ? 'Admin' : 'User';
          }
        } catch (_) {}
      }
    };
    xhr.send();
  })();

  // ==================== INIT ====================
  loadData();
})();
