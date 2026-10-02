// ======================================================
// HTML ESCAPE UTILITY
// ======================================================
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/`/g, '&#96;');
}

// ======================================================
// CUSTOM PROMPT DIALOG (replaces window.prompt for CSP safety)
// ======================================================
function customPrompt(message, defaultValue) {
  return new Promise(function (resolve) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--surface,#ffffff);border:1px solid var(--border-soft,#e2e8f0);border-radius:10px;padding:24px;min-width:320px;max-width:90vw;box-shadow:0 4px 14px rgba(15,23,42,0.10);';

    var label = document.createElement('p');
    label.textContent = message;
    label.style.cssText = 'margin:0 0 14px;color:var(--text-main,#0f172a);font-size:0.95rem;';

    var input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue || '';
    input.style.cssText = 'width:100%;box-sizing:border-box;';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn-secondary';

    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.type = 'button';
    okBtn.className = 'btn-primary';

    function close(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.onclick = function () { close(null); };
    okBtn.onclick = function () { close(input.value); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    };
    overlay.onclick = function (e) { if (e.target === overlay) close(null); };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    setTimeout(function () { input.focus(); input.select(); }, 50);
  });
}

// ======================================================
// CLIENT STAGE CONFIG (Section 2/6)
// This is the CLIENT-LEVEL pipeline stage shown on the main client
// page. It is intentionally separate from job.status (per-job
// workflow) and job.tags (per-job free-form labels) — see
// JOB_STATUSES / job tag handling further down in this file.
// ======================================================
const STATUS_ORDER = [
  "Lead",
  "Photo report",
  "Prospect",
  "Approved",
  "Invoiced",
  "Closed"
];

// Light-mode shades (Tailwind 700/800) keep small badge text at 4.5:1 or
// better on the tinted badge background. Dark mode needs brighter 300/400
// shades for the same badges to stay readable on a dark navy tint instead —
// using the light values in dark mode is what made status text look muddy.
const STATUS_COLORS = {
  "Lead": "#475569",
  "Photo report": "#92400e",
  "Prospect": "#6d28d9",
  "Approved": "#155e75",
  "Invoiced": "#1d4ed8",
  "Closed": "#166534"
};
const STATUS_COLORS_DARK = {
  "Lead": "#cbd5e1",
  "Photo report": "#fbbf24",
  "Prospect": "#c4b5fd",
  "Approved": "#67e8f9",
  "Invoiced": "#93c5fd",
  "Closed": "#4ade80"
};
function getStatusColor(status) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const map = isDark ? STATUS_COLORS_DARK : STATUS_COLORS;
  return map[status] || (isDark ? "#60a5fa" : "#2563eb");
}

function buildClientPrintStyle() {
  return `
    @page { margin: 0.5in; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      min-height: auto !important;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      filter: none !important;
      -webkit-filter: none !important;
      opacity: 1 !important;
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      text-shadow: none !important;
      mix-blend-mode: normal !important;
      --tw-text-opacity: 1 !important;
      --tw-bg-opacity: 1 !important;
      --tw-border-opacity: 1 !important;
      --tw-ring-opacity: 1 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      -webkit-text-stroke: 0.25px #000 !important;
      text-rendering: geometricPrecision !important;
    }

    body {
      font-family: Arial, Helvetica, sans-serif !important;
      padding: 0 !important;
    }

    .print-shell {
      width: 100%;
      max-width: none;
      padding: 0;
    }

    .print-shell .detail-card,
    .print-shell .panel-shell {
      width: 100% !important;
      max-width: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      opacity: 1 !important;
      -webkit-text-fill-color: #000 !important;
      -webkit-text-stroke: 0.35px #000 !important;
    }

    .print-shell .panel-header,
    .print-shell .panel-section,
    .print-shell .notes-section,
    .print-shell .panel-actions,
    .print-shell .panel-contact-links,
    .print-shell .panel-grid,
    .print-shell .field-stack,
    .print-shell .notes-list,
    .print-shell .notes-actions,
    .print-shell .details-grid {
      color: #000 !important;
      opacity: 1 !important;
      -webkit-text-fill-color: #000 !important;
      background: #fff !important;
    }

    .print-shell .panel-contact-links,
    .print-shell .panel-contact-links a,
    .print-shell .maps-link,
    .print-shell .field-stack a {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      text-decoration: underline !important;
      font-weight: 700 !important;
    }

    .print-shell label,
    .print-shell small,
    .print-shell p,
    .print-shell span,
    .print-shell div,
    .print-shell li,
    .print-shell td,
    .print-shell th,
    .print-shell h1,
    .print-shell h2,
    .print-shell h3,
    .print-shell h4,
    .print-shell h5,
    .print-shell h6 {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
    }

    .print-shell input,
    .print-shell select,
    .print-shell textarea {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      background: #fff !important;
      border: 1px solid #000 !important;
      opacity: 1 !important;
      filter: none !important;
      -webkit-appearance: none !important;
      appearance: none !important;
      padding: 8px 10px !important;
      min-height: 40px !important;
    }

    .print-shell button {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      background: #fff !important;
      border: 1px solid #000 !important;
      opacity: 1 !important;
      filter: none !important;
    }

    .print-shell .panel-actions {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
    }

    .print-shell .panel-actions .btn-primary {
      width: auto !important;
      min-width: 140px !important;
    }
  `;
}

function printClientWorkspace() {
  const source = projectPanel?.querySelector(".detail-card") || projectPanel;
  if (!source) return;

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    iframe.remove();
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return;
  }

  const clone = source.cloneNode(true);
  clone.classList.add("print-shell");
  clone.style.display = "block";
  clone.style.opacity = "1";
  clone.style.transform = "none";

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title><style>${buildClientPrintStyle()}</style></head><body></body></html>`);
  doc.close();
  doc.body.appendChild(clone);

  const trigger = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  };

  if (doc.fonts && doc.fonts.ready) {
    doc.fonts.ready.then(() => setTimeout(trigger, 50));
  } else {
    setTimeout(trigger, 100);
  }
}

// ======================================================
// PRINT STYLE
// ======================================================
(function injectPrintStyle() {
  const style = document.createElement("style");
  style.innerHTML = `
  @media print {
    @page {
      margin: 0.5in;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      min-height: auto !important;
    }

    #Main_header,
    .sidebar,
    #toastContainer,
    #pdfModal,
    #projectOverlay {
      display: none !important;
    }

    .crm-dashboard,
    .main-content {
      display: block !important;
      width: 100% !important;
      background: #fff !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
    }

    *,
    *::before,
    *::after {
      background: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      filter: none !important;
      -webkit-filter: none !important;
      opacity: 1 !important;
      color: rgb(0 0 0 / 1) !important;
      -webkit-text-fill-color: rgb(0 0 0 / 1) !important;
      text-shadow: none !important;
      mix-blend-mode: normal !important;
      isolation: auto !important;
      --tw-text-opacity: 1 !important;
      --tw-bg-opacity: 1 !important;
      --tw-border-opacity: 1 !important;
      --tw-ring-opacity: 1 !important;
      -webkit-text-stroke: 0.25px #000 !important;
      text-rendering: geometricPrecision !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .workspace,
    .client-content,
    .client-workspace,
    .clients-workspace,
    .detail-card,
    .panel-shell,
    .panel-grid,
    .panel-section,
    .panel-actions,
    .panel-contact-links,
    .notes-section,
    .notes-list,
    .notes-actions,
    .details-grid,
    .field-stack,
    form,
    input,
    select,
    textarea,
    button,
    label,
    h1, h2, h3, h4, h5, h6,
    p, span, a, strong, div {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
      background: #fff !important;
      -webkit-text-stroke: 0.25px #000 !important;
    }

    [class*="text-"],
    [class*="muted"],
    [class*="secondary"],
    [class*="gray"],
    [class*="grey"],
    .text-muted,
    .text-secondary,
    .text-gray-100,
    .text-gray-200,
    .text-gray-300,
    .text-gray-400,
    .text-gray-500,
    .text-gray-600,
    .text-gray-700,
    .text-gray-800,
    .text-gray-900 {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
      text-shadow: none !important;
      mix-blend-mode: normal !important;
      --tw-text-opacity: 1 !important;
      --tw-bg-opacity: 1 !important;
      --tw-border-opacity: 1 !important;
      --tw-ring-opacity: 1 !important;
    }

    small,
    label,
    legend,
    caption,
    figcaption,
    p,
    span,
    div,
    li,
    td,
    th {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
      text-shadow: none !important;
    }

    .client-workspace,
    .workspace,
    .container,
    .detail-card,
    .panel-shell,
    .panel-grid,
    .panel-section,
    .panel-actions,
    .panel-contact-links,
    .notes-section,
    .notes-list,
    .notes-actions {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
      background: #fff !important;
    }

    #projectPanel {
      display: block !important;
      position: static;
      left: 0;
      top: 0;
      width: 100%;
      max-width: none !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      transform: none !important;
      box-shadow: none !important;
      background: white !important;
      color: black !important;
      -webkit-text-fill-color: #000 !important;
    }

    #projectPanel .detail-card {
      box-shadow: none !important;
      background: white !important;
      color: black !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      transform: none !important;
    }

    #projectPanel,
    #projectPanel *,
    #projectPanel *::before,
    #projectPanel *::after {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      text-shadow: none !important;
      opacity: 1 !important;
      filter: none !important;
      -webkit-filter: none !important;
      mix-blend-mode: normal !important;
      background-image: none !important;
      font-weight: 600 !important;
      background: #fff !important;
      --tw-text-opacity: 1 !important;
      --tw-bg-opacity: 1 !important;
      --tw-border-opacity: 1 !important;
      --tw-ring-opacity: 1 !important;
      -webkit-text-stroke: 0.35px #000 !important;
    }

    #projectPanel .panel-contact-links,
    #projectPanel .panel-contact-links a {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      font-weight: 700 !important;
    }

    #projectPanel .panel-contact-links {
      gap: 10px !important;
      line-height: 1.45 !important;
    }

    #projectPanel .panel-contact-links a,
    #projectPanel .maps-link,
    #projectPanel .field-stack a {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      text-decoration: underline !important;
      text-underline-offset: 2px;
      font-weight: 600 !important;
    }

    #projectPanel label {
      color: #000 !important;
      font-weight: 600 !important;
    }

    #projectPanel input,
    #projectPanel select,
    #projectPanel textarea,
    #projectPanel button,
    #projectPanel h1,
    #projectPanel h2,
    #projectPanel h3,
    #projectPanel h4,
    #projectPanel h5,
    #projectPanel h6,
    #projectPanel p,
    #projectPanel strong,
    #projectPanel span,
    #projectPanel a,
    #projectPanel div {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
    }

    #projectPanel [class*="text-"],
    #projectPanel [class*="muted"],
    #projectPanel [class*="secondary"],
    #projectPanel [class*="gray"],
    #projectPanel [class*="grey"],
    #projectPanel .text-muted,
    #projectPanel .text-secondary,
    #projectPanel .text-gray-100,
    #projectPanel .text-gray-200,
    #projectPanel .text-gray-300,
    #projectPanel .text-gray-400,
    #projectPanel .text-gray-500,
    #projectPanel .text-gray-600,
    #projectPanel .text-gray-700,
    #projectPanel .text-gray-800,
    #projectPanel .text-gray-900 {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
      filter: none !important;
      text-shadow: none !important;
      mix-blend-mode: normal !important;
    }

    #projectPanel input,
    #projectPanel select,
    #projectPanel textarea {
      background: #fff !important;
      border: 1px solid #555 !important;
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      font-weight: 600 !important;
      opacity: 1 !important;
      filter: none !important;
      -webkit-filter: none !important;
      mix-blend-mode: normal !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      --tw-text-opacity: 1 !important;
      --tw-bg-opacity: 1 !important;
      --tw-border-opacity: 1 !important;
      --tw-ring-opacity: 1 !important;
      -webkit-text-stroke: 0.35px #000 !important;
    }

    #projectPanel input::placeholder,
    #projectPanel textarea::placeholder,
    #projectPanel ::placeholder {
      color: #000 !important;
      -webkit-text-fill-color: #000 !important;
      opacity: 1 !important;
    }

    #projectPanel .field-stack {
      gap: 10px !important;
    }

    #projectPanel .field-stack input {
      margin-bottom: 0 !important;
    }

    .notes-list {
      max-height: none !important;
      overflow: visible !important;
    }

    #closeBtn,
    #saveBtn,
    #delBtn,
    #estimateBtn,
    #invoiceBtn,
    #printBtn,
    #reviewBtn,
    #undoFinanceBtn,
    #pdf-drop-zone,
    #pdf-upload-btn {
      display: none !important;
    }

    a {
      color: #000 !important;
      text-decoration: none !important;
    }
  }`;
  document.head.appendChild(style);
})();

// ======================================================
// API WRAPPER
// ======================================================
window.api = {
  async _readResponseError(res, fallbackMessage) {
    try {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return data?.error || data?.message || fallbackMessage;
      }
      const text = await res.text();
      return text.trim() || fallbackMessage;
    } catch (err) {
      console.warn('Failed to parse error response:', err);
      return fallbackMessage;
    }
  },

  // Sidebar filters (salesperson, technician, year, stage, dates) and sort
  // are applied in the browser by renderSidebar, on top of this search.
  async searchClients(term = '', options = {}) {
    const { signal } = options;
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal });
    if (!res.ok) throw new Error("Search failed");
    return res.json();
  },

  async getClient(id) {
    const clients = await this.searchClients('');
    return clients.find(c => Number(c.id) === Number(id)) || null;
  },

  // Saves only the given client fields (the server leaves the rest as-is).
  async updateClientFields(id, fields) {
    const res = await fetch('/api/update-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Save failed'));
    return res.json();
  },

  async listAssignableUsers() {
    if (this._assignableUsers) return this._assignableUsers;
    const res = await fetch('/api/v2/admin/users');
    if (!res.ok) throw new Error('Failed to load users');
    const data = await res.json();
    this._assignableUsers = data.data || [];
    return this._assignableUsers;
  },

  async saveClient(client) {
    const name = `${client.fName || ''} ${client.lName || ''}`.trim();
    const res = await fetch('/api/save-client', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...client, name })
    });
    if (!res.ok) throw new Error("Save failed");
    return res.json();
  },

  async updateProject(data) {
    const payload = { ...data };
    if (payload.fName || payload.lName) {
      payload.name = `${payload.fName || ''} ${payload.lName || ''}`.trim();
    }
    const res = await fetch('/api/update-project', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Update failed");
    return res.json();
  },

  async deleteClient(id) {
    const res = await fetch('/api/delete-client', {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },

  async uploadPDFs(files, clientId) {
    const formData = new FormData();
    files.forEach(file => formData.append("files", file));
    const res = await fetch(`/api/pdf/upload/${clientId}`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },

  async getSupabaseConfig() {
    if (this._supabaseConfig) return this._supabaseConfig;
    const res = await fetch('/api/supabase-config');
    if (!res.ok) throw new Error('Failed to load Supabase config');
    this._supabaseConfig = await res.json();
    return this._supabaseConfig;
  },

  async getSupabaseClient() {
    if (this._supabaseClient) return this._supabaseClient;
    const config = await this.getSupabaseConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase direct upload is not configured');
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase client library is not available');
    }
    this._supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    return this._supabaseClient;
  },

  async uploadPDFToSupabaseDirect(files, clientId) {
    const supabaseClient = await this.getSupabaseClient();
    const config = await this.getSupabaseConfig();
    const uploaded = [];

    for (const file of files) {
      const cleanName = String(file.name || 'file').split('/').pop().split('\\').pop();
      const objectPath = `${clientId}/${Date.now()}-${cleanName}`;
      const { error } = await supabaseClient.storage
        .from(config.storageBucket || 'crm-files')
        .upload(objectPath, file, {
          upsert: true,
          contentType: file.type || 'application/pdf'
        });

      if (error) {
        throw error;
      }

      uploaded.push({
        name: cleanName,
        path: objectPath,
        url: '',
        ext: `.${cleanName.split('.').pop()}`
      });
    }

    return { success: true, files: uploaded };
  },

  async uploadPDFsWithFallback(files, clientId) {
    try {
      return await this.uploadPDFToSupabaseDirect(files, clientId);
    } catch (err) {
      console.warn('Direct supabase upload failed, falling back to backend upload:', err);
      return await this.uploadPDFs(files, clientId);
    }
  },

  async listPDFs(clientId) {
    const res = await fetch(`/api/pdf/list/${clientId}`);
    if (!res.ok) throw new Error("List PDFs failed");
    return res.json();
  },

  async deletePDF(clientId, fileName) {
    const res = await fetch(`/api/pdf/delete/${clientId}/${encodeURIComponent(fileName)}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },

  async updateTotal(clientId, total_due) {
    const res = await fetch(`/api/clients/${clientId}/total`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_due })
    });
    if (!res.ok) {
      throw new Error(await this._readResponseError(res, "Total update failed"));
    }
    return res.json();
  },

  async addPayment(clientId, payment) {
    const res = await fetch(`/api/clients/${clientId}/payment`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment })
    });
    if (!res.ok) {
      throw new Error(await this._readResponseError(res, "Payment failed"));
    }
    return res.json();
  },

  async resetAmountPaid(clientId) {
    const res = await fetch(`/api/clients/${clientId}/reset-paid`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error("Reset failed");
    return res.json();
  },

  async restoreFinanceState(clientId, state) {
    const res = await fetch(`/api/clients/${clientId}/finance-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    if (!res.ok) throw new Error("Restore failed");
    return res.json();
  },



  // ==========================
  // NOTES API
  // ==========================
  async listNotes(clientId) {
    const res = await fetch(`/api/notes/list/${clientId}`);
    if (!res.ok) {
      throw new Error(await this._readResponseError(res, "Failed to list notes"));
    }
    return res.json();
  },

  async addNote(clientId, content) {
    clientId = Number(clientId);
    const res = await fetch(`/api/notes/add/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error("Failed to add note");
    return res.json();
  },

  async updateNote(clientId, noteId, content) {
    const res = await fetch(`/api/notes/update/${clientId}/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error("Failed to update note");
    return res.json();
  },

  async deleteNote(clientId, noteId) {
    clientId = Number(clientId);
    const res = await fetch(`/api/notes/delete/${clientId}/${noteId}`, {
      method: "DELETE"
    });
    if (!res.ok) throw new Error("Failed to delete note");
    return res.json();
  },

  async sendInvoice(clientId) {
    return this._downloadDocument(clientId, 'invoice');
  },

  async sendEstimate(clientId) {
    return this._downloadDocument(clientId, 'estimate');
  },

  async _downloadDocument(clientId, mode, isJob = false) {
    const endpoint = isJob
      ? `/api/jobs/${clientId}/${mode === 'estimate' ? 'estimate' : 'invoice'}`
      : (mode === 'estimate' ? `/api/send-estimate/${clientId}` : `/api/send-invoice/${clientId}`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!res.ok) {
      let message = `Failed to generate ${mode}`;
      try { const d = await res.json(); message = d?.error || d?.message || message; } catch { /* ignore */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/i);
    const filename = match?.[1] || `${mode}-${clientId}.pdf`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { success: true, filename };
  },

  // ==========================
  // JOBS API
  // ==========================
  async listJobs(clientId) {
    const res = await fetch(`/api/jobs/client/${clientId}`);
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to list jobs'));
    return res.json();
  },

  async createJob(payload) {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to create job'));
    return res.json();
  },

  async updateJob(jobId, payload) {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to update job'));
    return res.json();
  },

  async addJobPayment(jobId, amount) {
    const res = await fetch(`/api/jobs/${jobId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to add job payment'));
    return res.json();
  },

  async reverseJobPayment(jobId, amount) {
    const res = await fetch(`/api/jobs/${jobId}/payment/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to undo payment'));
    return res.json();
  },

  async listJobPayments(jobId) {
    const res = await fetch(`/api/jobs/${jobId}/payments`);
    if (!res.ok) return { supported: false, payments: [] };
    return res.json();
  },

  // Itemized job costs + expense categories (admin only; see api/expenses.js)
  async listJobExpenses(jobId) {
    const res = await fetch(`/api/jobs/${jobId}/expenses`);
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to load job costs'));
    return res.json();
  },

  async addJobExpense(jobId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to add cost'));
    return res.json();
  },

  async itemizeExistingJobCost(jobId) {
    const res = await fetch(`/api/jobs/${jobId}/expenses/itemize-existing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to itemize the cost'));
    return res.json();
  },

  async updateJobExpense(jobId, expenseId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/expenses/${expenseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to update cost'));
    return res.json();
  },

  async deleteJobExpense(jobId, expenseId) {
    const res = await fetch(`/api/jobs/${jobId}/expenses/${expenseId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to remove cost'));
    return res.json();
  },

  async addJobLineItemsBulk(jobId, lineItems) {
    const res = await fetch(`/api/jobs/${jobId}/line-items/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line_items: lineItems })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to add services'));
    return res.json();
  },

  async deleteJob(jobId) {
    const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to delete job'));
    return res.json();
  },

  async updateJobTags(jobId, tags) {
    const res = await fetch(`/api/jobs/${jobId}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to update job tags'));
    return res.json();
  },

  async listJobLineItems(jobId) {
    const res = await fetch(`/api/jobs/${jobId}/line-items`);
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to list line items'));
    return res.json();
  },

  async addJobLineItem(jobId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/line-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to add line item'));
    return res.json();
  },

  async updateJobLineItem(jobId, itemId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/line-items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to update line item'));
    return res.json();
  },

  async deleteJobLineItem(jobId, itemId) {
    const res = await fetch(`/api/jobs/${jobId}/line-items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to delete line item'));
    return res.json();
  },

  async sendJobInvoice(jobId) {
    return this._downloadDocument(jobId, 'invoice', true);
  },

  async sendJobEstimate(jobId) {
    return this._downloadDocument(jobId, 'estimate', true);
  },

  // ==========================
  // JOB NOTES API (separate from client notes — scoped to one job)
  // ==========================
  async listJobNotes(jobId) {
    const res = await fetch(`/api/notes/job/${jobId}`);
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to list job notes'));
    return res.json();
  },

  async addJobNote(jobId, content) {
    const res = await fetch(`/api/notes/job/${jobId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to add job note'));
    return res.json();
  },

  async updateJobNote(jobId, noteId, content) {
    const res = await fetch(`/api/notes/job/${jobId}/${noteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: content })
    });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to update job note'));
    return res.json();
  },

  async deleteJobNote(jobId, noteId) {
    const res = await fetch(`/api/notes/job/${jobId}/${noteId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to delete job note'));
    return res.json();
  },

  // ==========================
  // JOB FILES API — documents and photos are the same storage, kept apart
  // only by the `category` each file is uploaded/listed under.
  // ==========================
  async listJobFiles(jobId, category) {
    const res = await fetch(`/api/job-files/${jobId}${category ? `?category=${encodeURIComponent(category)}` : ''}`);
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to list files'));
    return res.json();
  },

  // XHR (not fetch) so upload progress can be reported for large files.
  uploadJobFiles(jobId, category, files, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('category', category);
      Array.from(files).forEach((file) => formData.append('files', file));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/job-files/${jobId}/upload`);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data) {
          resolve(data);
        } else {
          reject(new Error((data && (data.error || data.message)) || `Upload failed (HTTP ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again'));
      xhr.ontimeout = () => reject(new Error('Upload timed out — try again or use a smaller file'));
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(formData);
    });
  },

  jobFileDownloadUrl(jobId, fileId) {
    return `/api/job-files/${jobId}/${fileId}/download`;
  },

  async deleteJobFile(jobId, fileId) {
    const res = await fetch(`/api/job-files/${jobId}/${fileId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await this._readResponseError(res, 'Failed to delete file'));
    return res.json();
  },

  async getEmailSettings() {
    if (this._emailSettings) return this._emailSettings;
    const res = await fetch('/api/email-settings');
    if (!res.ok) throw new Error('Failed to load email settings');
    this._emailSettings = await res.json();
    return this._emailSettings;
  },

  async saveEmailSettings(payload) {
    const res = await fetch('/api/email-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let message = 'Failed to save email settings';
      try {
        const data = await res.json();
        message = data?.error || data?.message || message;
      } catch {
        // Ignore non-JSON responses.
      }
      throw new Error(message);
    }
    this._emailSettings = await res.json();
    return this._emailSettings;
  },

  async getCompanyProfile() {
    if (this._companyProfile) return this._companyProfile;
    const res = await fetch('/api/company-profile');
    if (!res.ok) throw new Error('Failed to load company profile');
    this._companyProfile = await res.json();
    return this._companyProfile;
  },

  async saveCompanyProfile(payload) {
    const res = await fetch('/api/company-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let message = 'Failed to save company profile';
      try {
        const data = await res.json();
        message = data?.error || data?.message || message;
      } catch {
        // Ignore non-JSON responses.
      }
      throw new Error(message);
    }
    this._companyProfile = await res.json();
    return this._companyProfile;
  },

  async getDashboardStats() {
    const res = await fetch('/api/v2/dashboard/stats');
    if (!res.ok) return null;
    return res.json();
  },

  // ==========================
  // SERVICES API
  // ==========================
  async listServices(all = false) {
    const res = await fetch('/api/v2/services' + (all ? '?all=true' : ''));
    if (!res.ok) throw new Error('Failed to list services');
    return res.json();
  },

  async createService(payload) {
    const res = await fetch('/api/v2/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create service');
    }
    return res.json();
  },

  async updateService(id, payload) {
    const res = await fetch('/api/v2/services/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update service');
    }
    return res.json();
  },

  async deleteService(id) {
    const res = await fetch('/api/v2/services/' + id, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete service');
    }
    return res.json();
  },

  async listClientServices(clientId) {
    const res = await fetch('/api/v2/clients/' + clientId + '/services');
    if (!res.ok) throw new Error('Failed to list client services');
    return res.json();
  },

  async assignClientServices(clientId, serviceIds) {
    const res = await fetch('/api/v2/clients/' + clientId + '/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceIds })
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to assign services');
    }
    return res.json();
  },

  async removeClientService(clientId, assignmentId) {
    const res = await fetch('/api/v2/clients/' + clientId + '/services/' + assignmentId, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove service');
    }
    return res.json();
  },

  async getClientCashAggregate(clientId) {
    const res = await fetch('/api/v2/clients/' + clientId + '/cash-aggregate');
    if (!res.ok) return { totalCashCollected: 0, jobCount: 0 };
    return res.json();
  }
};
// ======================================================
// UPDATE FINANCE PAGE WHEN CLIENT TOTAL OR PAYMENT CHANGES
// ======================================================
function triggerFinanceUpdate() {
  // Dispatch a custom event for any finance listeners
  document.dispatchEvent(new Event('financeUpdated'));
}
// ======================================================
// FINANCE UNDO STACK (GLOBAL)
// ======================================================
let financeUndoStack = [];

// ======================================================
// DOM REFERENCES
// ======================================================
const clientList = document.getElementById("clientList");
const projectPanel = document.getElementById("projectPanel");
const searchInput = document.getElementById("searchClients");
const intakeFormEl = document.getElementById("clientIntakeForm");
const overlay = document.getElementById("projectOverlay");
const companyProfileModal = document.getElementById("companyProfileModal");
const companyProfileForm = document.getElementById("companyProfileForm");
const companyProfileBtn = document.getElementById("companyProfileBtn");
const closeCompanyProfileBtn = document.getElementById("closeCompanyProfile");
const cancelCompanyProfileBtn = document.getElementById("cancelCompanyProfile");
const saveCompanyProfileBtn = document.getElementById("saveCompanyProfile");
const companyNameEl = document.getElementById("companyName");
const companyAddressEl = document.getElementById("companyAddress");
const companyPhoneEl = document.getElementById("companyPhone");
const companyEmailEl = document.getElementById("companyEmail");
const emailSettingsModal = document.getElementById("emailSettingsModal");
const emailSettingsForm = document.getElementById("emailSettingsForm");
const emailSettingsBtn = document.getElementById("emailSettingsBtn");
const closeEmailSettingsBtn = document.getElementById("closeEmailSettings");
const cancelEmailSettingsBtn = document.getElementById("cancelEmailSettings");
const saveEmailSettingsBtn = document.getElementById("saveEmailSettings");
const emailProviderEl = document.getElementById("emailProvider");
const emailFromNameEl = document.getElementById("emailFromName");
const emailFromEmailEl = document.getElementById("emailFromEmail");
const emailReplyToEl = document.getElementById("emailReplyTo");
const emailSmtpHostEl = document.getElementById("emailSmtpHost");
const emailSmtpPortEl = document.getElementById("emailSmtpPort");
const emailSmtpPasswordEl = document.getElementById("emailSmtpPassword");
const emailSmtpSecureEl = document.getElementById("emailSmtpSecure");
// Keep overlay only as a backdrop layer; do not close modal on backdrop click.
// Client panel should close via explicit actions (X button / Delete flow).

let activeId = null;
let activeClient = null;
let searchTimeout = null;
let searchRequestController = null;
let isSaving = false;
let queuedSave = false;
let lastSearchTerm = "";
let selectedIndex = -1;
let sidebarAllClients = [];
let sidebarSearchTerm = "";
let sidebarRenderCount = 0;
const sidebarChunkSize = 60;
const SEARCH_DEBOUNCE_MS = 300;
let sidebarListContainer = null;
let newNoteSaving = false;
let emailSettingsLoading = false;
let currentEmailSettings = null;
let companyProfileLoading = false;
let currentCompanyProfile = null;
let mainDashboardRefreshTimer = null;
let mainDashboardRefreshInFlight = false;
let _platformFeatures = null;
// Homepage sort + filters, applied in the browser on top of the search
// results (see applySidebarFilters / sortSidebarClients).
const EMPTY_FILTERS = { salesperson: '', technician: '', year: '', status: '', dateFrom: '', dateTo: '' };
let _filterState = { ...EMPTY_FILTERS };
let _sortMode = 'stage';
const NONE_VALUE = '__none__';

function isClientPanelOpen() {
  return projectPanel?.style.display === "block";
}

function hasUnsavedClientPanelChanges() {
  const statusText = document.getElementById("saveStatus")?.textContent || "";
  return /unsaved/i.test(statusText);
}

async function refreshMainDashboard({ refreshOpenClient = true } = {}) {
  if (mainDashboardRefreshInFlight) return;
  mainDashboardRefreshInFlight = true;
  try {
    await refreshList();

    // Only the jobs list and totals are refreshed — never the form fields,
    // so anything typed but not yet saved stays put.
    if (refreshOpenClient && activeId && isClientPanelOpen()) {
      await refreshClientJobs(activeId, { reloadClient: true });
    }
  } finally {
    mainDashboardRefreshInFlight = false;
  }
}

function scheduleMainDashboardRefresh(options = {}) {
  if (mainDashboardRefreshTimer) {
    clearTimeout(mainDashboardRefreshTimer);
  }

  mainDashboardRefreshTimer = setTimeout(() => {
    mainDashboardRefreshTimer = null;
    refreshMainDashboard(options).catch((err) => {
      console.error("Main dashboard refresh failed:", err);
    });
  }, 150);
}

function setCompanyProfileFormValues(profile = {}) {
  if (companyNameEl) companyNameEl.value = profile.businessName || '';
  if (companyAddressEl) companyAddressEl.value = profile.businessAddress || '';
  if (companyPhoneEl) companyPhoneEl.value = profile.businessPhone || '';
  if (companyEmailEl) companyEmailEl.value = profile.businessEmail || '';

  const scopeEl = document.getElementById('defaultScopeOfWork');
  if (scopeEl) scopeEl.value = profile.defaultScopeOfWork || '';

  // Show existing logo preview if one is saved
  const preview = document.getElementById('companyLogoPreview');
  const img = document.getElementById('companyLogoImg');
  if (preview && img) {
    if (profile.logoUrl) {
      img.src = profile.logoUrl;
      preview.style.display = 'flex';
      preview.style.alignItems = 'center';
    } else {
      preview.style.display = 'none';
      img.src = '';
    }
  }
}

function collectCompanyProfilePayload() {
  return {
    businessName: companyNameEl?.value || '',
    businessAddress: companyAddressEl?.value || '',
    businessPhone: companyPhoneEl?.value || '',
    businessEmail: companyEmailEl?.value || '',
    defaultScopeOfWork: document.getElementById('defaultScopeOfWork')?.value || '',
    logoUrl: window._pendingLogoBase64 !== undefined
      ? window._pendingLogoBase64
      : (currentCompanyProfile?.logoUrl || '')
  };
}

async function openCompanyProfileModal() {
  if (!companyProfileModal || companyProfileLoading) return;

  companyProfileLoading = true;
  window._pendingLogoBase64 = undefined; // reset pending logo on open
  try {
    const response = await window.api.getCompanyProfile();
    currentCompanyProfile = response?.settings || null;
    setCompanyProfileFormValues(currentCompanyProfile || {});
    companyProfileModal.classList.add('open');
    companyProfileModal.setAttribute('aria-hidden', 'false');

    // Wire up logo file input
    const logoInput = document.getElementById('companyLogo');
    const preview = document.getElementById('companyLogoPreview');
    const img = document.getElementById('companyLogoImg');
    const removeBtn = document.getElementById('removeLogoBtn');

    if (logoInput) {
      logoInput.value = '';
      logoInput.onchange = () => {
        const file = logoInput.files?.[0];
        if (!file) return;
        // Warn if file is large — base64 encoding adds ~33% overhead, server limit is 5mb
        if (file.size > 3 * 1024 * 1024) {
          showToast('Logo is too large. Please use an image under 3MB.', 'error');
          logoInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target.result;
          // Store as base64 string (strip data URL prefix for server storage)
          window._pendingLogoBase64 = dataUrl;
          if (img) img.src = dataUrl;
          if (preview) { preview.style.display = 'flex'; preview.style.alignItems = 'center'; }
        };
        reader.readAsDataURL(file);
      };
    }

    if (removeBtn) {
      removeBtn.onclick = () => {
        window._pendingLogoBase64 = '';
        if (img) img.src = '';
        if (preview) preview.style.display = 'none';
        if (logoInput) logoInput.value = '';
      };
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to load company profile', 'error');
  } finally {
    companyProfileLoading = false;
  }
}

function closeCompanyProfileModal() {
  if (!companyProfileModal) return;
  companyProfileModal.classList.remove('open');
  companyProfileModal.setAttribute('aria-hidden', 'true');
  if (companyProfileForm) companyProfileForm.reset();
}

function getEmailProviderDefaults(provider) {
  if (provider === 'outlook') {
    return {
      smtpHost: 'smtp.office365.com',
      smtpPort: '587',
      smtpSecure: false
    };
  }

  if (provider === 'gmail') {
    return {
      smtpHost: 'smtp.gmail.com',
      smtpPort: '587',
      smtpSecure: false
    };
  }

  return {
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: false
  };
}

function applyEmailProviderDefaults(provider, { force = false } = {}) {
  const defaults = getEmailProviderDefaults(provider);
  if (emailSmtpHostEl && (force || !emailSmtpHostEl.value.trim())) {
    emailSmtpHostEl.value = defaults.smtpHost;
  }
  if (emailSmtpPortEl && (force || !emailSmtpPortEl.value.trim())) {
    emailSmtpPortEl.value = defaults.smtpPort;
  }
  if (emailSmtpSecureEl && force) {
    emailSmtpSecureEl.checked = defaults.smtpSecure;
  }
}

function collectEmailSettingsPayload() {
  return {
    provider: emailProviderEl?.value || 'gmail',
    fromName: emailFromNameEl?.value || '',
    fromEmail: emailFromEmailEl?.value || '',
    replyToEmail: emailReplyToEl?.value || '',
    smtpHost: emailSmtpHostEl?.value || '',
    smtpPort: Number(emailSmtpPortEl?.value || 0),
    smtpUser: emailFromEmailEl?.value || '',
    smtpPassword: emailSmtpPasswordEl?.value || '',
    smtpSecure: Boolean(emailSmtpSecureEl?.checked)
  };
}

function setEmailSettingsFormValues(settings = {}) {
  if (emailProviderEl) emailProviderEl.value = settings.provider || 'gmail';
  if (emailFromNameEl) emailFromNameEl.value = settings.fromName || '';
  if (emailFromEmailEl) emailFromEmailEl.value = settings.fromEmail || '';
  if (emailReplyToEl) emailReplyToEl.value = settings.replyToEmail || '';
  if (emailSmtpHostEl) emailSmtpHostEl.value = settings.smtpHost || '';
  if (emailSmtpPortEl) emailSmtpPortEl.value = settings.smtpPort || '587';
  if (emailSmtpPasswordEl) emailSmtpPasswordEl.value = '';
  if (emailSmtpSecureEl) emailSmtpSecureEl.checked = Boolean(settings.smtpSecure);
}

async function openEmailSettingsModal() {
  if (!emailSettingsModal) return;
  if (emailSettingsLoading) return;

  emailSettingsLoading = true;
  try {
    const response = await window.api.getEmailSettings();
    currentEmailSettings = response?.settings || null;
    setEmailSettingsFormValues(currentEmailSettings || {});
    applyEmailProviderDefaults(emailProviderEl?.value || 'gmail', { force: false });
    emailSettingsModal.classList.add('open');
    emailSettingsModal.setAttribute('aria-hidden', 'false');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Failed to load email settings', 'error');
  } finally {
    emailSettingsLoading = false;
  }
}

function closeEmailSettingsModal() {
  if (!emailSettingsModal) return;
  emailSettingsModal.classList.remove('open');
  emailSettingsModal.setAttribute('aria-hidden', 'true');
  if (emailSettingsForm) emailSettingsForm.reset();
}

async function ensureEmailSenderConfigured() {
  try {
    const response = await window.api.getEmailSettings();
    const settings = response?.settings || {};
    if (!settings.smtpUser || !settings.hasPassword) {
      return false;
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function isCenteredSidebarLayout() {
  const dashboard = document.querySelector(".crm-dashboard");
  if (!dashboard) return false;
  return window.getComputedStyle(dashboard).flexDirection === "column";
}

function shouldUseMobileSidebarSwitch() {
  return window.innerWidth <= 768;
}

// ======================================================
// SEARCH
// ======================================================
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const term = e.target.value.trim().toLowerCase();
    lastSearchTerm = term;
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
      if (searchRequestController) {
        searchRequestController.abort();
      }
      searchRequestController = new AbortController();

      try {
        const matchedStatus = STATUS_ORDER.find(
          s => s.toLowerCase() === term
        );

        if (matchedStatus) {
          const allClients = await window.api.searchClients("", { signal: searchRequestController.signal });
          renderSidebar(
            allClients.filter(c =>
              (c.status || "Lead").toLowerCase() === term
            ),
            term
          );
          return;
        }

        // Same exact-match shortcut as status, for the Recurring/One-Off
        // badge (client_type isn't part of the regular name/phone/email/
        // address text search, so it needs its own match here).
        const matchedType = ["recurring", "one-off"].includes(term) ? term : null;
        if (matchedType) {
          const allClients = await window.api.searchClients("", { signal: searchRequestController.signal });
          renderSidebar(
            allClients.filter(c => (c.client_type || "") === matchedType),
            term
          );
          return;
        }

        const filtered = await window.api.searchClients(term, { signal: searchRequestController.signal });
        renderSidebar(filtered, term);

      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
    const items = Array.from(document.querySelectorAll(".client-card"));
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
    }

    items.forEach((item, idx) => {
      item.classList.toggle("kb-selected", idx === selectedIndex);
      if (idx === selectedIndex) item.scrollIntoView({ block: "nearest" });
    });

    if (e.key === "Enter" && selectedIndex >= 0) {
      const id = parseInt(items[selectedIndex].dataset.id);
      if (!Number.isNaN(id)) openClient(id);
    }
  });
}

// ======================================================
// SORT & FILTER (homepage) — Salesperson, Technician, Year, Stage and
// date added. Everything runs on the already-loaded client list, so changing
// a control re-renders instantly without another request.
// ======================================================
var filterToggleBtn = document.getElementById('filterToggleBtn');
var filterPanel = document.getElementById('filterPanel');
var sortSelect = document.getElementById('sortClients');
var filterSalesperson = document.getElementById('filterSalesperson');
var filterTechnician = document.getElementById('filterTechnician');
var filterYear = document.getElementById('filterYear');
var filterStatus = document.getElementById('filterStatus');
var filterDateFrom = document.getElementById('filterDateFrom');
var filterDateTo = document.getElementById('filterDateTo');
var clearFilterBtn = document.getElementById('clearFilterBtn');
var _lastSidebarList = [];
var _lastSidebarTerm = '';

function clientYear(c) {
  const d = new Date(c.created_at);
  return Number.isFinite(d.getTime()) ? d.getFullYear() : null;
}

function salespersonLabel(c) {
  return (c.assigned_user_name || '').trim();
}

function technicianLabel(c) {
  return (c.technician || '').trim();
}

// Rebuilds the Salesperson/Technician/Year dropdowns from the loaded
// clients, keeping the current selection.
function populateFilterOptions(clients) {
  const fill = (select, allLabel, values, noneLabel, includeNone) => {
    if (!select) return;
    const current = select.value;
    const options = [`<option value="">${allLabel}</option>`]
      .concat(values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`));
    if (includeNone) options.push(`<option value="${NONE_VALUE}">${noneLabel}</option>`);
    select.innerHTML = options.join('');
    select.value = [...select.options].some(o => o.value === current) ? current : '';
  };
  const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const salespeople = unique(clients.map(salespersonLabel));
  const technicians = unique(clients.map(technicianLabel));
  const years = [...new Set(clients.map(clientYear).filter(Boolean))].sort((a, b) => b - a).map(String);
  fill(filterSalesperson, 'All salespeople', salespeople, 'Unassigned', clients.some(c => !salespersonLabel(c)));
  fill(filterTechnician, 'All technicians', technicians, 'No technician', clients.some(c => !technicianLabel(c)));
  fill(filterYear, 'All years', years, '', false);
  if (filterStatus && filterStatus.options.length <= 1) {
    filterStatus.innerHTML = '<option value="">All stages</option>' +
      STATUS_ORDER.map(s => `<option value="${s}">${s}</option>`).join('');
  }
}

function applySidebarFilters(list) {
  const f = _filterState;
  const from = f.dateFrom ? new Date(f.dateFrom + 'T00:00:00') : null;
  const to = f.dateTo ? new Date(f.dateTo + 'T23:59:59.999') : null;
  return list.filter(c => {
    if (f.salesperson === NONE_VALUE ? salespersonLabel(c) : (f.salesperson && salespersonLabel(c) !== f.salesperson)) return false;
    if (f.technician === NONE_VALUE ? technicianLabel(c) : (f.technician && technicianLabel(c) !== f.technician)) return false;
    if (f.year && String(clientYear(c)) !== f.year) return false;
    if (f.status && (c.status || 'Lead') !== f.status) return false;
    if (from || to) {
      const created = new Date(c.created_at);
      if (from && created < from) return false;
      if (to && created > to) return false;
    }
    return true;
  });
}

// Returns the group heading a client falls under for the current sort, or
// null when the sort doesn't group (stage and name use the status counts
// row / plain alphabetical order instead).
function sidebarGroupFor(c) {
  if (_sortMode === 'salesperson') return salespersonLabel(c) || 'Unassigned';
  if (_sortMode === 'technician') return technicianLabel(c) || 'No technician';
  if (_sortMode === 'year') return String(clientYear(c) || 'No date');
  return null;
}

function sortSidebarClients(list) {
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
  const byStage = (a, b) => STATUS_ORDER.indexOf(a.status || 'Lead') - STATUS_ORDER.indexOf(b.status || 'Lead');
  // Unassigned / no technician sort after named groups.
  const byLabel = (getLabel) => (a, b) => {
    const la = getLabel(a), lb = getLabel(b);
    if (!la !== !lb) return la ? -1 : 1;
    return la.localeCompare(lb) || byStage(a, b) || byName(a, b);
  };
  const sorters = {
    stage: (a, b) => byStage(a, b) || byNewest(a, b),
    salesperson: byLabel(salespersonLabel),
    technician: byLabel(technicianLabel),
    year: (a, b) => (clientYear(b) || 0) - (clientYear(a) || 0) || byNewest(a, b),
    name: byName
  };
  return list.slice().sort(sorters[_sortMode] || sorters.stage);
}

function readFilterControls() {
  _filterState = {
    salesperson: filterSalesperson ? filterSalesperson.value : '',
    technician: filterTechnician ? filterTechnician.value : '',
    year: filterYear ? filterYear.value : '',
    status: filterStatus ? filterStatus.value : '',
    dateFrom: filterDateFrom ? filterDateFrom.value : '',
    dateTo: filterDateTo ? filterDateTo.value : ''
  };
  updateFilterIndicator();
  renderSidebar(_lastSidebarList, _lastSidebarTerm);
}

function activeFilterCount() {
  return Object.values(_filterState).filter(Boolean).length;
}

function updateFilterIndicator() {
  if (!filterToggleBtn) return;
  const count = activeFilterCount();
  filterToggleBtn.classList.toggle('has-active-filters', count > 0);
  filterToggleBtn.title = count ? `Filter clients (${count} active)` : 'Filter clients';
}

if (filterToggleBtn) {
  filterToggleBtn.addEventListener('click', function () {
    var isVisible = filterPanel && filterPanel.style.display !== 'none';
    if (filterPanel) filterPanel.style.display = isVisible ? 'none' : '';
    filterToggleBtn.setAttribute('aria-expanded', String(!isVisible));
  });
}

[filterSalesperson, filterTechnician, filterYear, filterStatus, filterDateFrom, filterDateTo].forEach(function (el) {
  if (el) el.addEventListener('change', readFilterControls);
});

if (sortSelect) {
  try {
    const saved = localStorage.getItem('crm-client-sort');
    if (saved && [...sortSelect.options].some(o => o.value === saved)) sortSelect.value = saved;
  } catch (e) { /* storage unavailable */ }
  _sortMode = sortSelect.value || 'stage';
  sortSelect.addEventListener('change', function () {
    _sortMode = sortSelect.value || 'stage';
    try { localStorage.setItem('crm-client-sort', _sortMode); } catch (e) { /* ignore */ }
    renderSidebar(_lastSidebarList, _lastSidebarTerm);
  });
}

if (clearFilterBtn) {
  clearFilterBtn.addEventListener('click', function () {
    [filterSalesperson, filterTechnician, filterYear, filterStatus, filterDateFrom, filterDateTo].forEach(function (el) {
      if (el) el.value = '';
    });
    readFilterControls();
  });
}

// ======================================================
// QUICK SEARCH FROM TAG CLICK (Section 3) — clicking a status or type
// badge on a client card behaves exactly like typing that value into the
// search box: it fills the box and fires the same input event, so it goes
// through the normal search/debounce/status-exact-match path below.
// ======================================================
function searchByTagClick(value) {
  if (!value || !searchInput) return;
  searchInput.value = value;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.focus();
}

// ======================================================
// ADD CLIENT
// ======================================================
if (intakeFormEl) {
  const fNameInput = document.getElementById("fName");
  const lNameInput = document.getElementById("lName");

  intakeFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();

    const client = {
      fName: fNameInput?.value || "",
      lName: lNameInput?.value || "",
      email: document.getElementById("email")?.value || "",
      phone: document.getElementById("phone")?.value || "",
      address: document.getElementById("address")?.value || "",
      status: "Lead"
    };

    try {
      await window.api.saveClient(client);
      await refreshList();
      e.target.reset();
      showToast("Client added", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to add client", "error");
    }
  });
}

// ======================================================
// SIDEBAR
// ======================================================
async function refreshList() {
  try {
    if (clientList) {
      clientList.innerHTML = `<li class="loading-state">Loading clients...</li>`;
    }
    const clients = await window.api.searchClients("");
    populateFilterOptions(clients || []);
    if (!clients || clients.length === 0) {
      _lastSidebarList = [];
      clientList.innerHTML = `<li class="empty-state" style="text-align:center; padding:24px 16px;">
        <div style="margin-bottom:8px; color:var(--text-muted);"><i data-lucide="user" style="width:28px;height:28px;"></i></div>
        <div style="font-weight:700; color:var(--text-main); margin-bottom:4px;">No clients yet</div>
        <div style="font-size:0.85rem; color:var(--text-muted);">Add your first lead using the form above.</div>
      </li>`;
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    // Keep an active search term applied across refreshes.
    const term = (searchInput && searchInput.value.trim().toLowerCase()) || "";
    if (term) {
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    renderSidebar(clients);
  } catch (err) {
    console.error(err);
    if (clientList) {
      clientList.innerHTML =
        `<li class="empty-state">Unable to load clients. Check server connection and refresh.</li>`;
    }
  }
}

function renderSidebar(list = [], term = "") {
  if (!clientList) return;

  _lastSidebarList = list;
  _lastSidebarTerm = term;
  const visible = sortSidebarClients(applySidebarFilters(list));

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  visible.forEach(c => { counts[c.status || "Lead"] = (counts[c.status || "Lead"] || 0) + 1; });

  const countsHTML = `
    <li class="status-counts" style="list-style:none; padding:0; margin:0 0 8px 0;">
      ${STATUS_ORDER.map(s =>
        `<div class="status-count-row" data-filter-status="${escapeHtml(s)}" title="Click to search this status" style="background:${getStatusColor(s)}2e; color:${getStatusColor(s)}; border:1px solid ${getStatusColor(s)}70; cursor:pointer;">
          ${s}: ${counts[s]}
        </div>`
      ).join("")}
    </li>
  `;

  sidebarAllClients = visible;
  sidebarSearchTerm = term;
  sidebarRenderCount = 0;
  sidebarLastGroup = null;

  const emptyHTML = !visible.length && list.length
    ? `<li class="empty-state" style="list-style:none;">No clients match these filters.</li>`
    : "";

  clientList.innerHTML =
    countsHTML + emptyHTML +
    `<li id="clientListItems" style="list-style:none; padding:0; margin:0;"></li>`;
  sidebarListContainer = document.getElementById("clientListItems");
  renderSidebarChunk();

  selectedIndex = -1;
}

var sidebarLastGroup = null;

function highlightTerm(text, term) {
  const safe = escapeHtml(text || "");
  if (!term) return safe;
  const pattern = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(pattern, "ig"), (m) => `<mark>${m}</mark>`);
}

function buildClientCard(c, term = "") {
  const color = getStatusColor(c.status);
  const displayName = String(c.name || "").trim();
  const salesperson = salespersonLabel(c);
  const technician = technicianLabel(c);

  var retentionBadge = '';
  if (c.client_type === 'recurring' && window._retentionRiskIds && window._retentionRiskIds.indexOf(c.id) !== -1) {
    retentionBadge = '<span class="retention-risk-badge">Retention Risk</span>';
  }

  return `
    <div class="client-card" data-id="${c.id}" data-name="${escapeHtml(displayName)}" style="border-left:4px solid ${color};">
      <div class="client-card-top">
        <div class="client-name">${highlightTerm(displayName, term)}${retentionBadge}</div>
        <div class="client-status" style="background:${color}2e; color:${color}; border:1px solid ${color}70;" data-filter-status="${escapeHtml(c.status || "Lead")}" title="Click to search this status">${escapeHtml(c.status || "Lead")}</div>
      </div>
      ${c.phone ? `<div class="client-meta"><i data-lucide="phone"></i> ${highlightTerm(c.phone, term)}</div>` : ''}
      ${c.email ? `<div class="client-meta client-meta-email"><i data-lucide="mail"></i> ${highlightTerm(c.email, term)}</div>` : ''}
      <div class="client-people">
        <span><span class="client-people-label">Sales</span> ${escapeHtml(salesperson || 'Unassigned')}</span>
        <span><span class="client-people-label">Tech</span> ${escapeHtml(technician || '—')}</span>
      </div>
    </div>
  `;
}

function renderSidebarChunk() {
  if (!sidebarListContainer) return;
  if (sidebarRenderCount >= sidebarAllClients.length) return;

  const next = sidebarAllClients.slice(
    sidebarRenderCount,
    sidebarRenderCount + sidebarChunkSize
  );
  sidebarRenderCount += next.length;

  let html = "";
  next.forEach(c => {
    const group = sidebarGroupFor(c);
    if (group !== null && group !== sidebarLastGroup) {
      const groupCount = sidebarAllClients.filter(x => sidebarGroupFor(x) === group).length;
      html += `<div class="client-group-header">${escapeHtml(group)} <span>${groupCount}</span></div>`;
      sidebarLastGroup = group;
    }
    html += buildClientCard(c, sidebarSearchTerm);
  });
  sidebarListContainer.insertAdjacentHTML("beforeend", html);
  if (window.lucide) window.lucide.createIcons();
}

// ======================================================
// CLIENT OVERVIEW (main client page)
//
// A condensed summary: who the client is, who is handling them, their jobs,
// and the money rolled up from those jobs. The detailed work — services,
// payments, cost, files, photos and notes — happens inside each job (see
// openJobPanel). Money that was recorded on the client record itself before
// jobs were used lives in the "Client account" workspace
// (openClientAccountPanel) and is included in the totals, so nothing that
// already exists disappears.
// ======================================================
let activeClientJobs = [];
let activeClientFiles = [];     // client-level files (the older PDF drop box)
let activeClientServices = [];  // client-level services (the older scope list)

const JOB_STATUS_COLORS = {
  Prospect: '#6d28d9', Approved: '#155e75', Completed: '#92400e',
  Invoice: '#1d4ed8', Closed: '#166534'
};
// Same brightening as getStatusColor() — dark mode needs the 300/400
// shades, not the light-mode 600/700 ones, to stay readable.
const JOB_STATUS_COLORS_DARK = {
  Prospect: '#c4b5fd', Approved: '#67e8f9', Completed: '#fbbf24',
  Invoice: '#93c5fd', Closed: '#4ade80'
};
function getJobStatusColor(status) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const map = isDark ? JOB_STATUS_COLORS_DARK : JOB_STATUS_COLORS;
  return map[status] || (isDark ? '#60a5fa' : '#2563eb');
}

function formatShortDate(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '';
}

function hasClientLevelMoney(client) {
  return ['total_due', 'amount_paid', 'balance', 'job_cost'].some(k => Math.abs(Number((client && client[k]) || 0)) > 0.005);
}

function hasClientAccountData(client) {
  return hasClientLevelMoney(client) || activeClientFiles.length > 0 || activeClientServices.length > 0;
}

// Client totals = the client's jobs + anything recorded on the client record
// itself. Regular users never receive client-level money or job costs from
// the API (api/access-control.js), so for them this sums the job amounts
// they can already see on each job.
function computeClientTotals(client, jobs) {
  const sum = (key) => (jobs || []).reduce((s, j) => s + Number(j[key] || 0), 0);
  const totalDue = sum('total_due') + Number((client && client.total_due) || 0);
  const received = sum('amount_paid') + Number((client && client.amount_paid) || 0);
  const cost = sum('job_cost') + Number((client && client.job_cost) || 0);
  return {
    totalDue,
    received,
    balance: totalDue - received,
    cost,
    marginPct: totalDue > 0 ? Math.round(((totalDue - cost) / totalDue) * 100) : null
  };
}

function renderClientTotals(client, jobs) {
  const el = document.getElementById('clientTotals');
  if (!el) return;
  const t = computeClientTotals(client, jobs);
  const admin = isAdminUser();
  const tile = (id, label, value, sub = '', extra = '') => `
    <div class="total-tile ${extra}" id="${id}">
      <span class="total-tile-label">${label}</span>
      <strong class="total-tile-value">${value}</strong>
      ${sub ? `<span class="total-tile-sub">${sub}</span>` : ''}
    </div>`;
  el.innerHTML =
    tile('totalDueTile', 'Total Amount Due', '$' + formatMoney(t.totalDue)) +
    tile('receivedTile', 'Money Received', '$' + formatMoney(t.received)) +
    tile('balanceTile', 'Balance', '$' + formatMoney(t.balance), '', t.balance > 0.005 ? 'is-due' : '') +
    (admin ? tile('costTile', 'Cost', '$' + formatMoney(t.cost), t.marginPct === null ? '' : `Margin ${t.marginPct}%`) : '');
}

function clientAccountRowHtml(client) {
  const admin = isAdminUser();
  const bits = [];
  if (activeClientServices.length) bits.push(`${activeClientServices.length} service${activeClientServices.length === 1 ? '' : 's'}`);
  if (activeClientFiles.length) bits.push(`${activeClientFiles.length} file${activeClientFiles.length === 1 ? '' : 's'}`);
  const money = admin && hasClientLevelMoney(client) ? `
    <span class="job-row-money">
      <span><span class="job-row-money-label">Due</span> $${formatMoney(client.total_due)}</span>
      <span><span class="job-row-money-label">Received</span> $${formatMoney(client.amount_paid)}</span>
      <span class="${Number(client.balance) > 0.005 ? 'is-due' : ''}"><span class="job-row-money-label">Balance</span> $${formatMoney(client.balance)}</span>
    </span>` : '<span class="job-row-money"></span>';
  return `
    <button type="button" class="job-row job-row-account" data-client-account="1">
      <span class="job-row-main">
        <span class="job-row-title">Client account</span>
        <span class="job-row-sub">Recorded on the client before jobs${bits.length ? ' · ' + bits.join(' · ') : ''}</span>
      </span>
      <span class="job-row-status job-row-status-neutral">Client-level</span>
      ${money}
    </button>`;
}

function renderClientJobs(client) {
  const list = document.getElementById('jobs-list');
  if (!list) return;
  const admin = isAdminUser();
  const rows = activeClientJobs.map(job => {
    const color = getJobStatusColor(job.status);
    const margin = admin && Number(job.total_due) > 0
      ? Math.round(((Number(job.total_due) - Number(job.job_cost || 0)) / Number(job.total_due)) * 100)
      : null;
    return `
      <button type="button" class="job-row" data-job-id="${job.id}" style="border-left-color:${color};">
        <span class="job-row-main">
          <span class="job-row-title">${escapeHtml(job.title || 'Untitled job')}</span>
          <span class="job-row-sub">${formatShortDate(job.created_at)}${margin !== null ? ` · Margin ${margin}%` : ''}</span>
        </span>
        <span class="job-row-status" style="color:${color}; background:${color}1f; border-color:${color}66;">${escapeHtml(job.status || '')}</span>
        <span class="job-row-money">
          <span><span class="job-row-money-label">Due</span> $${formatMoney(job.total_due)}</span>
          <span><span class="job-row-money-label">Received</span> $${formatMoney(job.amount_paid)}</span>
          <span class="${Number(job.balance) > 0.005 ? 'is-due' : ''}"><span class="job-row-money-label">Balance</span> $${formatMoney(job.balance)}</span>
        </span>
      </button>`;
  });
  if (client && hasClientAccountData(client)) rows.push(clientAccountRowHtml(client));
  list.innerHTML =
    (rows.length ? rows.join('') : '<div class="jobs-empty">No jobs yet — add the first one.</div>') +
    '<button type="button" id="quick-add-job-btn" class="add-job-btn">+ Job</button>';
}

// Reloads the jobs list and totals for the open client without touching the
// form fields above them (so typed-but-unsaved edits are never lost).
async function refreshClientJobs(clientId, { reloadClient = false } = {}) {
  if (!clientId || Number(clientId) !== Number(activeId)) return;
  const [jobsData, files, services, fresh] = await Promise.all([
    window.api.listJobs(clientId).catch((err) => { console.error(err); return null; }),
    window.api.listPDFs(clientId).then(d => d.files || []).catch(() => []),
    window.api.listClientServices(clientId).then(d => d.assignments || []).catch(() => []),
    reloadClient ? window.api.getClient(clientId).catch(() => null) : Promise.resolve(null)
  ]);
  if (Number(clientId) !== Number(activeId)) return; // switched clients meanwhile
  if (fresh && activeClient) activeClient = { ...activeClient, ...fresh };
  if (jobsData) activeClientJobs = jobsData.jobs || [];
  activeClientFiles = files;
  activeClientServices = services;
  if (!jobsData) {
    const list = document.getElementById('jobs-list');
    if (list) list.innerHTML = '<div class="jobs-empty" style="color:var(--danger);">Failed to load jobs.</div><button type="button" id="quick-add-job-btn" class="add-job-btn">+ Job</button>';
    return;
  }
  renderClientJobs(activeClient);
  renderClientTotals(activeClient, activeClientJobs);
}

function refreshOpenClientJobs() {
  return refreshClientJobs(activeId, { reloadClient: true }).catch(err => console.error(err));
}

function setupTechnicianField(client) {
  const list = document.getElementById('technicianOptions');
  if (!list) return;
  const names = new Set();
  (_lastSidebarList || []).forEach(c => { if (c.technician) names.add(c.technician.trim()); });
  if (isAdminUser()) {
    window.api.listAssignableUsers()
      .then(users => {
        users.forEach(u => { if (u.display_name) names.add(u.display_name.trim()); });
        list.innerHTML = [...names].sort().map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
      })
      .catch(() => {});
  }
  list.innerHTML = [...names].sort().map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

async function openClient(id) {
  if (!id) return;
  activeId = id;
  activeClientJobs = [];
  activeClientFiles = [];
  activeClientServices = [];
  try {
    const clients = await window.api.searchClients("");
    const client = clients.find(c => c.id == id);
    if (!client) return;
    activeClient = client;
    projectPanel.dataset.clientName = client.name || "";
    const admin = isAdminUser();
    const stageColor = getStatusColor(client.status);
    const mapsLink = client.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
      : "";

    projectPanel.innerHTML = `
      <div class="detail-card animate-panel panel-shell client-overview" style="opacity:0; transform:translateY(-20px); transition:0.25s ease;">
        <button id="closeBtn" class="close-x" aria-label="Save and close">&times;</button>
        <header class="detail-header panel-header">
          <div class="panel-title-block">
            <div class="panel-kicker">Client</div>
            <h2 class="client-overview-name">
              <span id="clientHeaderName">${escapeHtml(client.name || "")}</span>
              <span class="stage-badge" style="background:${stageColor}2e; color:${stageColor}; border:1px solid ${stageColor}70;">${escapeHtml(client.status || 'Lead')}</span>
            </h2>
          </div>
          <div class="contact-quick-links panel-contact-links">
            ${client.phone ? `<span><i data-lucide="phone"></i> <a href="tel:${encodeURIComponent(client.phone)}">${escapeHtml(client.phone)}</a></span>` : ''}
            ${client.email ? `<span><i data-lucide="mail"></i> <a href="mailto:${encodeURIComponent(client.email)}">${escapeHtml(client.email)}</a></span>` : ''}
          </div>
          <span id="saveStatus" class="save-status-chip">Saved</span>
        </header>

        <div id="clientTotals" class="client-totals" aria-live="polite">
          <div class="total-tile"><span class="total-tile-label">Totals</span><strong class="total-tile-value">…</strong></div>
        </div>
        <p class="client-totals-note">Totals add up this client's jobs${admin ? ' (and any client-level amounts)' : ''}. Open a job to change them.</p>

        <div class="details-grid panel-grid">
          <label for="p-name">Name</label>
          <input type="text" id="p-name" value="${escapeHtml(client.name || '')}" maxlength="260">

          <label for="p-status">Stage</label>
          <select id="p-status">
            ${STATUS_ORDER.map(s =>
              `<option value="${s}" ${client.status === s ? "selected" : ""}>${s}</option>`
            ).join("")}
          </select>

          <label for="p-assigned-user">Salesperson</label>
          ${admin
            ? `<select id="p-assigned-user"><option value="">Loading users...</option></select>`
            : `<div class="job-modal-readout" id="p-assigned-user-readout">${escapeHtml(client.assigned_user_name || (window.__USER__ && (window.__USER__.displayName || window.__USER__.email)) || 'You')}</div>`}

          <label for="p-technician">Technician</label>
          <div class="field-stack">
            <input type="text" id="p-technician" list="technicianOptions" maxlength="120" placeholder="Who does the work" value="${escapeHtml(client.technician || '')}">
            <datalist id="technicianOptions"></datalist>
          </div>

          <label for="p-address">Job Address</label>
          <div class="field-stack">
            <input type="text" id="p-address" value="${escapeHtml(client.address || "")}">
            ${client.address
              ? `<a href="${mapsLink}" target="_blank" rel="noopener" class="maps-link"><i data-lucide="map-pin"></i> Open in Google Maps</a>`
              : ""}
          </div>

          <label for="p-phone">Phone Number</label>
          <input type="tel" id="p-phone" value="${escapeHtml(client.phone || "")}">

          <label for="p-email">Email Address</label>
          <input type="email" id="p-email" value="${escapeHtml(client.email || "")}">

          <!-- ===== JOBS — each job is where its detailed work lives ===== -->
          <section class="panel-section panel-full-span" id="jobs-section">
            <div class="panel-section-header">
              <h3>Jobs</h3>
              <span class="panel-section-note">Open a job for its services, payments, cost, files, photos and notes.</span>
            </div>
            <div id="jobs-list" class="jobs-list">
              <div class="jobs-empty">Loading jobs...</div>
            </div>
          </section>

          <details id="client-notes-details" class="panel-collapse panel-full-span">
            <summary>Client Notes <span id="clientNotesCount" class="summary-count"></span></summary>
            <div id="notes-section" class="notes-section">
              <span class="panel-section-note">Notes about the client. Job-specific notes live inside each job.</span>
              <div id="notes-list" class="notes-list"></div>
              <div class="notes-actions">
                <textarea id="new-note-input" placeholder="Add a note..." rows="4"></textarea>
                <button id="add-note-btn" class="btn-primary add-note-btn">Add Note</button>
              </div>
            </div>
          </details>

          <div class="panel-actions panel-full-span">
            <button id="saveBtn" class="btn-primary" style="flex:2;">Save Changes</button>
            <button id="reviewBtn" class="btn-primary btn-quiet" style="flex:2;">Send Google Review</button>
            <button id="printBtn" class="btn-primary btn-quiet" style="flex:1;">Print</button>
            <button id="delBtn" class="btn-primary btn-danger-soft" style="flex:1;">Delete</button>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();

    requestAnimationFrame(() => {
      const panel = projectPanel.querySelector(".animate-panel");
      if (panel) {
        panel.style.opacity = 1;
        panel.style.transform = "translateY(0)";
      }
    });

    const jobsSection = document.getElementById('jobs-section');
    if (jobsSection) {
      jobsSection.addEventListener('click', (e) => {
        const addBtn = e.target.closest('#quick-add-job-btn');
        if (addBtn) { openNewJobModal(id); return; }
        const accountRow = e.target.closest('[data-client-account]');
        if (accountRow) { openClientAccountPanel(); return; }
        const row = e.target.closest('[data-job-id]');
        if (!row) return;
        const job = activeClientJobs.find(j => Number(j.id) === Number(row.dataset.jobId));
        if (job) openJobPanel(job, id, refreshOpenClientJobs);
      });
    }

    setupNotesSection(id);
    setupAssignedUserField(id, client.assigned_user_id);
    setupTechnicianField(client);
    setupDirtyTracking();
    setSaveStatus("saved");
    // SHOW MODAL
    projectPanel.style.display = "block";
    if (overlay) {
      overlay.style.display = "block";
      overlay.style.zIndex = "9999";
    }
    // ==============================
    // MOBILE VIEW SWITCH
    // ==============================
    if (shouldUseMobileSidebarSwitch()) {
      const sidebar = document.querySelector(".sidebar");
      const mainContent = document.querySelector(".main-content");
      if (sidebar) sidebar.classList.add("mobile-hidden");
      if (mainContent) mainContent.classList.add("mobile-full");
    }

    await refreshClientJobs(id);
  } catch (err) {
    console.error(err);
    showToast("Failed to open client", "error");
  }
}

// ======================================================
// CLIENT ACCOUNT — money, services and files recorded on the client record
// itself (how the CRM worked before jobs). Everything that used to sit on
// the main client page lives here now, unchanged in behavior: Total Due,
// payments + undo, job cost & margin, client estimate/invoice PDFs, the
// client's service list, and the client PDF drop box. Its amounts are part
// of the client's totals.
// ======================================================
async function openClientAccountPanel() {
  const clientId = activeId;
  if (!clientId) return;
  const existing = document.getElementById('clientAccountOverlay');
  if (existing) existing.remove();

  const fresh = await window.api.getClient(clientId).catch(() => null);
  if (fresh) activeClient = { ...activeClient, ...fresh };
  const client = activeClient || {};
  const admin = isAdminUser();

  const accountOverlay = document.createElement('div');
  accountOverlay.id = 'clientAccountOverlay';
  accountOverlay.className = 'job-modal-overlay';
  accountOverlay.innerHTML = `
    <div class="job-modal-card job-workspace" role="dialog" aria-modal="true" aria-labelledby="clientAccountTitle">
      <button id="closeClientAccount" class="job-modal-close" aria-label="Save and close">&times;</button>
      <div class="job-modal-kicker">Client account · ${escapeHtml(client.name || '')}</div>
      <h3 id="clientAccountTitle" class="job-workspace-heading">Client-level amounts, services &amp; files</h3>
      <p class="field-hint">What was recorded on the client itself before jobs were used. It stays here and is included in the client's totals. New work should go in a job.</p>

      ${admin ? `
      <section class="job-section">
        <h4 class="job-section-title">Money</h4>
        <div class="job-money-tiles">
          <div class="total-tile"><span class="total-tile-label">Total Due</span><strong class="total-tile-value" id="acct-total-display">$${formatMoney(client.total_due)}</strong></div>
          <div class="total-tile"><span class="total-tile-label">Received</span><strong class="total-tile-value" id="amountPaidDisplay">$${formatMoney(client.amount_paid)}</strong></div>
          <div class="total-tile"><span class="total-tile-label">Balance</span><strong class="total-tile-value" id="balanceDisplay">$${formatMoney(client.balance)}</strong></div>
          <div class="total-tile"><span class="total-tile-label">Cost</span><strong class="total-tile-value" id="jobCostDisplay">$${formatMoney(client.job_cost)}</strong><span class="total-tile-sub" id="marginPctDisplay">${Number(client.total_due) > 0 ? 'Margin ' + Math.round(((Number(client.total_due) - Number(client.job_cost || 0)) / Number(client.total_due)) * 100) + '%' : ''}</span></div>
        </div>
        <div class="job-money-inputs">
          <div class="job-modal-field">
            <label for="totalDueInput">Total Due</label>
            <div class="job-payment-row">
              <input type="text" id="totalDueInput" inputmode="decimal" value="${Number(client.total_due) ? formatMoney(client.total_due) : ''}" placeholder="0.00">
              <button id="saveTotalBtn" type="button" class="btn-primary">Save</button>
            </div>
          </div>
          <div class="job-modal-field">
            <label for="jobCostInput">Cost</label>
            <input type="text" id="jobCostInput" inputmode="decimal" value="${Number(client.job_cost) ? formatMoney(client.job_cost) : ''}" placeholder="0.00">
          </div>
        </div>
        <div class="job-modal-field">
          <label for="paymentInput">Payments</label>
          <div class="job-payment-row">
            <input type="text" id="paymentInput" inputmode="decimal" placeholder="Payment amount">
            <button id="addPaymentBtn" type="button" class="btn-primary">Add Payment</button>
            <button id="undoFinanceBtn" type="button" class="btn-primary btn-quiet">Undo</button>
          </div>
        </div>
        <div class="job-services-actions">
          <button id="estimateBtn" type="button" class="btn-primary btn-quiet">Download Estimate</button>
          <button id="invoiceBtn" type="button" class="btn-primary btn-quiet">Download Invoice</button>
        </div>
      </section>` : ''}

      <section class="job-section">
        <h4 class="job-section-title">Client services</h4>
        <p class="field-hint">The client's saved services. New jobs can start from this list.</p>
        <div id="scope-services-list" class="scope-services-chips"></div>
        <div class="job-services-actions">
          <button id="add-scope-service-btn" type="button" class="btn-primary">+ Service</button>
          <button id="manage-services-btn" type="button" class="btn-primary btn-quiet" style="display:none;">Manage Presets</button>
        </div>
        <textarea id="p-scope" style="display:none;">${escapeHtml(client.scope_of_work || '')}</textarea>
      </section>

      <section class="job-section">
        <h4 class="job-section-title">Client files</h4>
        <div id="pdf-drop-zone" class="drop-zone"><i data-lucide="file-text"></i> Drop PDFs here</div>
        <div class="job-services-actions">
          <button id="pdf-upload-btn" type="button" class="panel-secondary-btn">Upload PDF</button>
          <input type="file" id="pdf-file-input" accept=".pdf,application/pdf" multiple hidden />
        </div>
        <div id="pdf-list" class="panel-list"></div>
      </section>
    </div>
  `;
  document.body.appendChild(accountOverlay);
  if (window.lucide) window.lucide.createIcons();

  let closing = false;
  async function saveAndClose() {
    if (closing) return;
    closing = true;
    try {
      await autoSaveClientAccountFields(client);
    } catch (err) {
      closing = false;
      showToast(`Couldn't save: ${err.message}. Nothing was closed.`, 'error');
      return;
    }
    accountOverlay.remove();
    await refreshOpenClientJobs();
  }
  accountOverlay._requestClose = saveAndClose;
  accountOverlay.querySelector('#closeClientAccount').onclick = saveAndClose;
  accountOverlay.addEventListener('click', (e) => { if (e.target === accountOverlay) saveAndClose(); });

  if (admin) setupClientAccountFinance(accountOverlay, client);
  setupScopeServices(clientId, {
    onChange: async () => {
      const scope = document.getElementById('p-scope');
      if (!scope) return;
      try {
        await window.api.updateClientFields(clientId, { scope_of_work: scope.value });
        if (activeClient) activeClient.scope_of_work = scope.value;
      } catch (err) {
        console.error(err);
        showToast('Services changed, but the client scope text could not be saved', 'error');
      }
    }
  });
  setupDropZone();
  setupPDFUploadButton();
  loadPDFs(clientId);
}

// Re-reads the client row and redraws the client-account money tiles.
async function refreshClientAccountMoney(overlayEl) {
  const fresh = await window.api.getClient(activeId);
  if (!fresh) return;
  activeClient = { ...activeClient, ...fresh };
  const set = (id, value) => { const el = overlayEl.querySelector('#' + id); if (el) el.textContent = value; };
  set('acct-total-display', '$' + formatMoney(fresh.total_due));
  set('amountPaidDisplay', '$' + formatMoney(fresh.amount_paid));
  set('balanceDisplay', '$' + formatMoney(fresh.balance));
  set('jobCostDisplay', '$' + formatMoney(fresh.job_cost));
  set('marginPctDisplay', Number(fresh.total_due) > 0
    ? 'Margin ' + Math.round(((Number(fresh.total_due) - Number(fresh.job_cost || 0)) / Number(fresh.total_due)) * 100) + '%'
    : '');
  triggerFinanceUpdate();
}

function setupClientAccountFinance(overlayEl, client) {
  const saveTotalBtn = overlayEl.querySelector("#saveTotalBtn");
  const addPaymentBtn = overlayEl.querySelector("#addPaymentBtn");
  const undoBtn = overlayEl.querySelector("#undoFinanceBtn");
  const totalDueInput = overlayEl.querySelector("#totalDueInput");
  const paymentInput = overlayEl.querySelector("#paymentInput");
  const costInput = overlayEl.querySelector("#jobCostInput");
  const estimateBtn = overlayEl.querySelector("#estimateBtn");
  const invoiceBtn = overlayEl.querySelector("#invoiceBtn");
  if (!saveTotalBtn || !addPaymentBtn) return;

  applyMoneyInputBehavior(totalDueInput);
  applyMoneyInputBehavior(paymentInput);
  applyMoneyInputBehavior(costInput);

  const pushUndo = () => financeUndoStack.push({
    clientId: activeId,
    total_due: activeClient?.total_due,
    amount_paid: activeClient?.amount_paid,
    balance: activeClient?.balance
  });

  saveTotalBtn.onclick = async () => {
    if (saveTotalBtn.disabled) return;
    try {
      saveTotalBtn.disabled = true;
      pushUndo();
      await window.api.updateTotal(activeId, parseMoney(totalDueInput?.value) || 0);
      await refreshClientAccountMoney(overlayEl);
      showToast("Total updated", "success");
    } catch (err) {
      console.error(err);
      showToast(err?.message || "Failed to update total", "error");
    } finally {
      saveTotalBtn.disabled = false;
    }
  };

  addPaymentBtn.onclick = async () => {
    if (addPaymentBtn.disabled) return;
    const payment = parseMoney(paymentInput?.value) || 0;
    if (payment <= 0) {
      showToast("Enter a valid payment", "error");
      return;
    }
    try {
      addPaymentBtn.disabled = true;
      pushUndo();
      await window.api.addPayment(activeId, payment);
      paymentInput.value = '';
      await refreshClientAccountMoney(overlayEl);
      showToast("Payment added", "success");
    } catch (err) {
      console.error(err);
      showToast(err?.message || "Failed to add payment", "error");
    } finally {
      addPaymentBtn.disabled = false;
    }
  };

  if (undoBtn) {
    undoBtn.onclick = async () => {
      const last = financeUndoStack.length ? financeUndoStack[financeUndoStack.length - 1] : null;
      if (!last || Number(last.clientId) !== Number(activeId)) {
        showToast("Nothing to undo", "info");
        return;
      }
      if (!confirm("Undo the last payment/total change?")) return;
      financeUndoStack.pop();
      try {
        await window.api.restoreFinanceState(last.clientId, {
          total_due: last.total_due,
          amount_paid: last.amount_paid,
          balance: last.balance
        });
        await refreshClientAccountMoney(overlayEl);
        if (totalDueInput) totalDueInput.value = Number(activeClient.total_due) ? formatMoney(activeClient.total_due) : '';
        showToast("Undo complete", "success");
      } catch (err) {
        console.error(err);
        showToast("Undo failed", "error");
      }
    };
  }

  const downloadDoc = (btn, mode) => async () => {
    try {
      btn.disabled = true;
      btn.textContent = "Downloading...";
      if (mode === 'estimate') await window.api.sendEstimate(activeId);
      else await window.api.sendInvoice(activeId);
      showToast(mode === 'estimate' ? "Estimate downloaded" : "Invoice downloaded", "success");
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to generate ${mode}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = mode === 'estimate' ? "Download Estimate" : "Download Invoice";
    }
  };
  if (estimateBtn) estimateBtn.onclick = downloadDoc(estimateBtn, 'estimate');
  if (invoiceBtn) invoiceBtn.onclick = downloadDoc(invoiceBtn, 'invoice');
}

// Closing the client account saves what was typed but not submitted: a
// changed Total Due or Cost, and an amount sitting in the Payment box. A
// blank or unchanged field is left alone, so nothing is written twice.
async function autoSaveClientAccountFields() {
  if (!isAdminUser() || !activeId) return;
  const current = activeClient || {};
  const totalEl = document.getElementById('totalDueInput');
  const costEl = document.getElementById('jobCostInput');
  const paymentEl = document.getElementById('paymentInput');

  if (totalEl && totalEl.value.trim() !== '') {
    const total = parseMoney(totalEl.value);
    if (Number.isFinite(total) && Math.abs(total - Number(current.total_due || 0)) > 0.005) {
      financeUndoStack.push({ clientId: activeId, total_due: current.total_due, amount_paid: current.amount_paid, balance: current.balance });
      await window.api.updateTotal(activeId, total);
    }
  }
  if (costEl) {
    const cost = costEl.value.trim() === '' ? 0 : parseMoney(costEl.value);
    if (Number.isFinite(cost) && cost >= 0 && Math.abs(cost - Number(current.job_cost || 0)) > 0.005) {
      await window.api.updateClientFields(activeId, { job_cost: cost });
    }
  }
  if (paymentEl && paymentEl.value.trim()) {
    const amount = parseMoney(paymentEl.value);
    if (Number.isFinite(amount) && amount > 0) {
      financeUndoStack.push({ clientId: activeId, total_due: current.total_due, amount_paid: current.amount_paid, balance: current.balance });
      await window.api.addPayment(activeId, amount);
      paymentEl.value = '';
    }
  }
  triggerFinanceUpdate();
}

// ======================================================
// SAVE STATUS UI
// ======================================================
function setSaveStatus(state) {
  const el = document.getElementById("saveStatus");
  if (!el) return;

  if (state === "saving") {
    el.textContent = "Saving…";
    el.style.color = "var(--warning-text)";
    return;
  }

  if (state === "error") {
    el.textContent = "Save failed";
    el.style.color = "var(--danger-text)";
    return;
  }

  if (state === "unsaved") {
    el.textContent = "Unsaved changes";
    el.style.color = "var(--warning-text)";
    return;
  }

  el.textContent = "Saved";
  el.style.color = "var(--success-text)";
}

function markDirty() {
  setSaveStatus("unsaved");
}

function setupDirtyTracking() {
  ["p-name", "p-status", "p-address", "p-phone", "p-email", "p-technician", "new-note-input"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });
}

// ======================================================
// NOTES SECTION
// ======================================================
async function setupNotesSection(clientId) {
  const notesList = document.getElementById("notes-list");
  const newNoteInput = document.getElementById("new-note-input");
  const addNoteBtn = document.getElementById("add-note-btn");
  if (!notesList || !newNoteInput || !addNoteBtn) return;

  clientId = Number(clientId);

  async function loadNotes() {
    notesList.innerHTML = "";

    try {
      const data = await window.api.listNotes(clientId);
      const countEl = document.getElementById("clientNotesCount");
      if (countEl) countEl.textContent = data.notes && data.notes.length ? `(${data.notes.length})` : "";
      if (!data.notes || data.notes.length === 0) {
        notesList.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">No notes yet.</div>`;
        return;
      }

      data.notes.forEach(note => {
        const noteDiv = document.createElement("div");
        noteDiv.style.display = "flex";
        noteDiv.style.justifyContent = "space-between";
        noteDiv.style.alignItems = "center";
        noteDiv.style.background = "var(--surface-muted)";
        noteDiv.style.border = "1px solid var(--border-soft)";
        noteDiv.style.padding = "6px 10px";
        noteDiv.style.borderRadius = "6px";

        const contentDiv = document.createElement("div");
        contentDiv.innerText = note.content || "";
        contentDiv.style.flex = "1";
        contentDiv.style.marginRight = "6px";
        contentDiv.style.color = "var(--text-main)";
        contentDiv.style.whiteSpace = "pre-wrap";
        contentDiv.style.wordBreak = "break-word";

        const editBtn = document.createElement("button");
        editBtn.innerText = "Edit";
        editBtn.type = "button";
        editBtn.className = "btn-secondary btn-sm";

        const deleteBtn = document.createElement("button");
        deleteBtn.innerText = "Delete";
        deleteBtn.type = "button";
        deleteBtn.className = "btn-danger btn-sm";
        deleteBtn.style.marginLeft = "6px";

        editBtn.onclick = async () => {
          const current = note.content || "";
          const textarea = document.createElement("textarea");
          textarea.value = current;
          textarea.rows = 4;
          textarea.style.flex = "1";
          textarea.style.resize = "vertical";
          textarea.dataset.noteId = note.id;
          textarea.dataset.clientId = clientId;
          textarea.dataset.original = current;

          const saveBtn = document.createElement("button");
          saveBtn.innerText = "Save";
          saveBtn.type = "button";
          saveBtn.className = "btn-primary btn-sm";
          saveBtn.style.marginLeft = "6px";

          const cancelBtn = document.createElement("button");
          cancelBtn.innerText = "Cancel";
          cancelBtn.type = "button";
          cancelBtn.className = "btn-secondary btn-sm";
          cancelBtn.style.marginLeft = "6px";

          noteDiv.replaceChild(textarea, contentDiv);
          noteDiv.insertBefore(saveBtn, editBtn);
          noteDiv.insertBefore(cancelBtn, editBtn);
          editBtn.style.display = "none";
        textarea.addEventListener("input", markDirty);

          cancelBtn.onclick = () => loadNotes();
          saveBtn.onclick = async () => {
            const trimmed = textarea.value.trim();
            if (!trimmed) { showToast("Note cannot be empty", "error"); return; }
            try {
              await window.api.updateNote(clientId, note.id, trimmed);
              loadNotes();
            } catch (err) {
              console.error(err);
              showToast("Failed to update note", "error");
            }
          };
        };

        deleteBtn.onclick = async () => {
          if (!confirm("Delete this note?")) return;
          try {
            setSaveStatus("saving");
            await window.api.deleteNote(clientId, note.id);
            loadNotes();
            setSaveStatus("saved");
          } catch (err) {
            console.error(err);
            showToast("Failed to delete note", "error");
          }
        };

        noteDiv.appendChild(contentDiv);
        noteDiv.appendChild(editBtn);
        noteDiv.appendChild(deleteBtn);
        notesList.appendChild(noteDiv);
      });
    } catch (err) {
      console.error(err);
    }
  }


  async function addNoteFromInput({ silent = false } = {}) {
    if (newNoteSaving) return;
    const content = newNoteInput.value.trim();
    if (!content) return;
    newNoteSaving = true;
    try {
      setSaveStatus("saving");
      await window.api.addNote(clientId, content);
      newNoteInput.value = "";
      loadNotes();
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
      if (!silent) showToast("Failed to add note", "error");
    } finally {
      newNoteSaving = false;
    }
  }

  addNoteBtn.onclick = async () => {
    const content = newNoteInput.value.trim();
    if (!content) { showToast("Cannot add empty note", "error"); return; }
    await addNoteFromInput({ silent: false });
  };

  newNoteInput.addEventListener("input", markDirty);

  loadNotes();
}

// ======================================================
// + JOB — creates a job for this client. A job can start blank, from the
// client's saved services and scope, from the company default scope, or as
// a copy of an earlier job. Copying is how recurring work is handled: copy
// "September Maintenance" and the new job is suggested as "October
// Maintenance" with the same services and scope.
// ======================================================
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// "September Maintenance" -> "October Maintenance"; "December 2025 Service"
// -> "January 2026 Service"; anything without a month -> "<title> (copy)".
function nextRecurringTitle(title) {
  const t = String(title || '').trim();
  const re = new RegExp('\\b(' + MONTH_NAMES.join('|') + ')\\b', 'i');
  const m = t.match(re);
  if (!m) return t ? `${t} (copy)` : 'New Job';
  const idx = MONTH_NAMES.findIndex(n => n.toLowerCase() === m[1].toLowerCase());
  let result = t.replace(re, MONTH_NAMES[(idx + 1) % 12]);
  if (idx === 11) result = result.replace(/\b(20\d{2})\b/, (y) => String(Number(y) + 1));
  return result;
}

function serviceRate(assignment) {
  const custom = assignment.customRate;
  return custom !== null && custom !== undefined ? Number(custom) : Number(assignment.defaultRate || 0);
}

function lineItemsFromClientServices(assignments) {
  return (assignments || []).map(a => ({
    description: a.serviceName || 'Service',
    quantity: 1,
    unit_price: serviceRate(a),
    category: 'Labor'
  }));
}

function copyLineItems(items) {
  return (items || []).map(i => ({
    description: i.description,
    quantity: i.quantity,
    unit_price: i.unit_price,
    category: i.category
  }));
}

function copyExpenses(expenses) {
  return (expenses || []).map(e => ({
    description: e.description,
    amount: e.amount,
    category_id: e.category_id
  }));
}

function scopeFromLineItems(items) {
  return (items || []).map(i => String(i.description || '').trim()).filter(Boolean).map(d => `- ${d}`).join('\n');
}

async function openNewJobModal(clientId) {
  const existing = document.getElementById('newJobModalOverlay');
  if (existing) existing.remove();

  const admin = isAdminUser();
  const clientScope = (activeClient && activeClient.scope_of_work) || '';
  const clientServices = activeClientServices.slice();
  let companyScope = '';
  try {
    const profile = await window.api.getCompanyProfile();
    companyScope = profile?.settings?.defaultScopeOfWork || '';
  } catch (e) { /* no company default */ }
  const existingJobs = activeClientJobs.slice();
  const hasClientDefaults = Boolean(clientScope || clientServices.length);

  const initialSource = hasClientDefaults ? 'client' : (companyScope ? 'company' : 'blank');
  const sourceOptions = [
    `<option value="blank">Blank job</option>`,
    hasClientDefaults ? `<option value="client">Client's saved services &amp; scope</option>` : '',
    companyScope ? `<option value="company">Company default scope</option>` : '',
    ...existingJobs.map(j => `<option value="job-${j.id}">Copy of: ${escapeHtml(j.title || 'Untitled job')}</option>`)
  ].join('');

  const modal = document.createElement('div');
  modal.id = 'newJobModalOverlay';
  modal.className = 'job-modal-overlay';
  modal.innerHTML = `
    <div class="job-modal-card" role="dialog" aria-modal="true" aria-labelledby="newJobHeading">
      <button id="closeNewJobModal" class="job-modal-close" aria-label="Cancel">&times;</button>
      <div class="job-modal-kicker" id="newJobHeading">New Job · ${escapeHtml((activeClient && activeClient.name) || '')}</div>

      <div class="job-modal-field">
        <label for="new-job-title">Job name</label>
        <input id="new-job-title" type="text" placeholder="e.g. Roof Replacement, October Maintenance" maxlength="200">
      </div>

      <div class="job-modal-grid">
        <div class="job-modal-field">
          <label for="new-job-status">Status</label>
          <select id="new-job-status">
            ${JOB_STATUSES.map((s) => `<option value="${s}" ${s === 'Prospect' ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="job-modal-field">
          <label for="new-job-copy-from">Start from</label>
          <select id="new-job-copy-from">${sourceOptions}</select>
        </div>
      </div>
      <div id="new-job-source-summary" class="field-hint"></div>

      <div class="job-modal-field">
        <label for="new-job-scope">Scope of Work</label>
        <textarea id="new-job-scope" rows="4" placeholder="Describe the work for this job..."></textarea>
        <span class="field-hint">This job keeps its own copy — edit freely. Services can be added or removed inside the job.</span>
      </div>

      <div class="job-modal-field">
        <label for="new-job-notes">Notes</label>
        <textarea id="new-job-notes" rows="3" placeholder="Site details, customer preferences, follow-ups..."></textarea>
      </div>

      <div class="job-modal-actions">
        <button id="createJobBtn" class="btn-primary">Create Job</button>
        <button id="cancelNewJobBtn" class="btn-primary btn-quiet">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const titleEl = modal.querySelector('#new-job-title');
  const scopeEl = modal.querySelector('#new-job-scope');
  const sourceEl = modal.querySelector('#new-job-copy-from');
  const summaryEl = modal.querySelector('#new-job-source-summary');
  const notesEl = modal.querySelector('#new-job-notes');
  let suggestedTitle = '';
  let sourceItems = [];      // line items the new job will start with
  let sourceExpenses = [];   // itemized costs copied from a previous job (admin)
  let sourceJob = null;
  let sourceToken = 0;

  async function applySource() {
    const value = sourceEl.value;
    const token = ++sourceToken;
    sourceItems = [];
    sourceExpenses = [];
    sourceJob = null;
    if (value === 'client') {
      scopeEl.value = clientScope;
      sourceItems = lineItemsFromClientServices(clientServices);
    } else if (value === 'company') {
      scopeEl.value = companyScope;
    } else if (value.startsWith('job-')) {
      sourceJob = existingJobs.find(j => `job-${j.id}` === value) || null;
      scopeEl.value = sourceJob ? (sourceJob.scope_of_work || '') : '';
      if (sourceJob) {
        try {
          const data = await window.api.listJobLineItems(sourceJob.id);
          if (token !== sourceToken) return;
          sourceItems = copyLineItems(data.lineItems || []);
          if (admin) {
            const costs = await window.api.listJobExpenses(sourceJob.id);
            if (token !== sourceToken) return;
            sourceExpenses = costs.supported ? copyExpenses(costs.expenses) : [];
          }
        } catch (err) {
          console.error(err);
        }
        if (!titleEl.value.trim() || titleEl.value === suggestedTitle) {
          suggestedTitle = nextRecurringTitle(sourceJob.title);
          titleEl.value = suggestedTitle;
        }
      }
    } else {
      scopeEl.value = '';
    }
    if (token !== sourceToken) return;
    const names = sourceItems.map(i => i.description).filter(Boolean);
    summaryEl.textContent = names.length
      ? `Starts with ${names.length} service${names.length === 1 ? '' : 's'}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}.`
      : '';
  }

  sourceEl.value = initialSource;
  sourceEl.addEventListener('change', applySource);
  applySource();

  function discard() {
    const typed = titleEl.value.trim() && titleEl.value !== suggestedTitle || notesEl.value.trim();
    if (typed && !confirm('Discard this new job? It has not been created yet.')) return;
    modal.remove();
  }
  modal._requestClose = discard;
  modal.querySelector('#closeNewJobModal').onclick = discard;
  modal.querySelector('#cancelNewJobBtn').onclick = discard;
  modal.addEventListener('click', (e) => { if (e.target === modal) discard(); });

  const createBtn = modal.querySelector('#createJobBtn');
  createBtn.onclick = async () => {
    if (createBtn.disabled) return;
    try {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      const payload = {
        client_id: clientId,
        title: titleEl.value.trim() || 'New Job',
        status: modal.querySelector('#new-job-status').value,
        scope_of_work: scopeEl.value
      };
      if (admin) {
        if (sourceItems.length) payload.line_items = sourceItems;
        if (sourceExpenses.length) payload.expenses = sourceExpenses;
        if (sourceJob) {
          if (!sourceExpenses.length) payload.job_cost = Number(sourceJob.job_cost || 0);
          if (!sourceItems.length) payload.total_due = Number(sourceJob.total_due || 0);
        }
      } else if (sourceItems.length && !payload.scope_of_work.trim()) {
        // Regular users can't set prices, so a copied job's services come
        // across as scope lines instead of priced line items.
        payload.scope_of_work = scopeFromLineItems(sourceItems);
      }

      const result = await window.api.createJob(payload);
      const notesText = notesEl.value.trim();
      if (notesText && result.job) {
        try {
          await window.api.addJobNote(result.job.id, notesText);
        } catch (err) {
          console.error(err);
          showToast('Job created, but the note could not be saved', 'error');
        }
      }

      showToast('Job created', 'success');
      modal.remove();
      triggerFinanceUpdate();
      await refreshClientJobs(clientId);
      if (result.job) openJobPanel(result.job, clientId, refreshOpenClientJobs);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to create job', 'error');
      createBtn.disabled = false;
      createBtn.textContent = 'Create Job';
    }
  };

  setTimeout(() => titleEl.focus(), 50);
}

// ======================================================
// SCOPE OF WORK - SERVICE MANAGER
// ======================================================
// ======================================================
// ASSIGNED SALESPERSON (Section 3/6) — admin can reassign;
// regular users just see their own name (read-only).
// ======================================================
async function setupAssignedUserField(clientId, currentAssignedUserId) {
  if (!isAdminUser()) return;
  const select = document.getElementById('p-assigned-user');
  if (!select) return;

  try {
    const users = await window.api.listAssignableUsers();

    select.innerHTML = '<option value="">Unassigned</option>' +
      users.map((u) => `<option value="${u.id}" ${String(u.id) === String(currentAssignedUserId) ? 'selected' : ''}>${escapeHtml(u.display_name || u.email)}</option>`).join('');

    select.onchange = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_user_id: select.value || null })
        });
        if (!res.ok) throw new Error(await window.api._readResponseError(res, 'Failed to reassign client'));
        if (activeClient && Number(activeClient.id) === Number(clientId)) {
          activeClient.assigned_user_id = select.value || null;
          activeClient.assigned_user_name = select.value ? select.options[select.selectedIndex].textContent : '';
        }
        showToast('Salesperson updated', 'success');
        await refreshList();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to reassign client', 'error');
      }
    };
  } catch (err) {
    console.error(err);
    select.innerHTML = '<option value="">Could not load users</option>';
  }
}

// onChange runs after a service is added or removed (the client account
// saves the client's scope text right away).
async function setupScopeServices(clientId, { onChange } = {}) {
  const listEl = document.getElementById('scope-services-list');
  const addBtn = document.getElementById('add-scope-service-btn');
  const manageBtn = document.getElementById('manage-services-btn');

  if (!listEl || !addBtn) return;

  // Show manage button only for admins
  if (manageBtn && window.__USER__ && window.__USER__.role === 'admin') {
    manageBtn.style.display = '';
  }

  async function loadScopeServices() {
    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;width:100%;">Loading...</div>';
    try {
      const data = await window.api.listClientServices(clientId);
      var assignments = data.assignments || [];
      listEl.innerHTML = '';

      if (assignments.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;width:100%;">No saved services. Use "+ Service" to add one.</div>';
        return;
      }

      // Build scope text for hidden textarea (backward compat)
      var scopeLines = [];

      assignments.forEach(function (cs) {
        var chip = document.createElement('span');
        chip.style.cssText =
          'display:inline-flex;align-items:center;gap:4px;' +
          'background:var(--primary-soft);border:1px solid var(--border-soft);' +
          'border-radius:var(--radius-sm);padding:4px 10px 4px 12px;' +
          'font-size:0.82rem;color:var(--text-main);';

        var label = document.createElement('span');
        label.textContent = cs.serviceName || 'Service #' + cs.serviceId;
        chip.appendChild(label);

        var rate = cs.customRate || cs.defaultRate;
        if (rate > 0) {
          var rateSpan = document.createElement('span');
          rateSpan.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:700;color:var(--primary-text);margin-left:2px;';
          rateSpan.textContent = '$' + formatMoney(rate);
          chip.appendChild(rateSpan);
        }

        var removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.type = 'button';
        removeBtn.style.cssText =
          'border:none;background:transparent;color:var(--danger-text);min-height:0;' +
          'cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px;margin-left:2px;';
        removeBtn.title = 'Remove ' + cs.serviceName;
        removeBtn.setAttribute('aria-label', 'Remove ' + cs.serviceName);
        removeBtn.onclick = async function () {
          try {
            await window.api.removeClientService(clientId, cs.id);
            showToast(cs.serviceName + ' removed', 'success');
            await loadScopeServices();
            await updateScopeHiddenField();
            if (onChange) await onChange();
          } catch (err) {
            showToast('Failed to remove service', 'error');
          }
        };
        chip.appendChild(removeBtn);
        listEl.appendChild(chip);

        scopeLines.push('- ' + cs.serviceName + (rate > 0 ? ' ($' + formatMoney(rate) + ')' : ''));
      });

      // Update hidden textarea with service text
      var hiddenScope = document.getElementById('p-scope');
      if (hiddenScope && scopeLines.length > 0) {
        hiddenScope.value = scopeLines.join('\n');
      }
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div style="color:var(--danger);font-size:0.85rem;width:100%;">Failed to load services.</div>';
    }
  }

  addBtn.onclick = function () {
    openServicePicker(clientId, async function () {
      await loadScopeServices();
      await updateScopeHiddenField();
      if (onChange) await onChange();
    });
  };

  if (manageBtn) {
    manageBtn.onclick = function () {
      openManageServicesModal(function () {
        // Reload the picker if it's open, or just refresh
      });
    };
  }

  await loadScopeServices();
}

async function updateScopeHiddenField() {
  var hiddenScope = document.getElementById('p-scope');
  if (!hiddenScope) return;

  // Read the actual assigned services via API to build the text
  if (!activeId) return;
  try {
    var data = await window.api.listClientServices(activeId);
    var assignments = data.assignments || [];
    if (assignments.length > 0) {
      var lines = assignments.map(function (cs) {
        var rate = cs.customRate || cs.defaultRate;
        return '- ' + cs.serviceName + (rate > 0 ? ' ($' + formatMoney(rate) + ')' : '');
      });
      hiddenScope.value = lines.join('\n');
    } else {
      hiddenScope.value = '';
    }
  } catch (e) {
    // Silently fail; hidden field keeps its prior value
  }
}

// ======================================================
// SERVICE PICKER MODAL
// ======================================================
function openServicePicker(clientId, onSave) {
  var existing = document.getElementById('servicePickerOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'servicePickerOverlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,0.5);' +
    'display:flex;align-items:center;justify-content:center;' +
    'z-index:20000;padding:16px;';

  overlay.innerHTML =
    '<div style="' +
      'position:relative;width:min(520px,100%);max-height:80vh;overflow-y:auto;' +
      'background:var(--surface);' +
      'border:1px solid var(--border-soft);border-radius:18px;' +
      'padding:24px;box-shadow: var(--shadow-lift);color:var(--text-main);' +
    '">' +
      '<button type="button" id="closeServicePicker" class="close-x" aria-label="Close">&times;</button>' +
      '<div style="font-size:0.75rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px;">Add Services</div>' +
      '<h3 style="margin:0 0 16px;font-size:1.1rem;">Select services to add to scope</h3>' +
      '<div id="servicePickerList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">' +
        '<div style="color:var(--text-muted);">Loading services...</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="servicePickerSaveBtn" class="btn-primary" style="flex:1;">Add Selected</button>' +
        '<button id="servicePickerCancelBtn" class="btn-primary btn-quiet" style="flex:1;">Cancel</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  overlay.querySelector('#closeServicePicker').onclick = function () { overlay.remove(); };
  overlay.querySelector('#servicePickerCancelBtn').onclick = function () { overlay.remove(); };
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

  var saveBtn = overlay.querySelector('#servicePickerSaveBtn');
  var listEl = overlay.querySelector('#servicePickerList');

  async function loadServices() {
    listEl.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';
    try {
      var svcData = await window.api.listServices();
      var services = svcData.services || [];

      // Get currently assigned service IDs
      var assignedData = await window.api.listClientServices(clientId);
      var assignedIds = (assignedData.assignments || []).map(function (a) { return a.serviceId; });

      if (services.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted);">No services available. Ask an admin to create presets.</div>';
        return;
      }

      var available = services.filter(function (s) { return assignedIds.indexOf(s.id) === -1; });

      if (available.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted);">All available services are already assigned.</div>';
        return;
      }

      listEl.innerHTML = '';
      var checked = [];

      available.forEach(function (svc) {
        var row = document.createElement('label');
        row.style.cssText =
          'display:flex;align-items:center;gap:10px;padding:10px 12px;' +
          'border-radius:10px;border:1px solid var(--border-soft);' +
          'background:var(--surface-muted);cursor:pointer;transition:0.15s ease;';

        row.addEventListener('mouseenter', function () {
          row.style.borderColor = 'rgba(71,167,245,0.5)';
        });
        row.addEventListener('mouseleave', function () {
          row.style.borderColor = 'var(--border-soft)';
        });

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = svc.id;
        cb.style.cssText = 'width:18px;height:18px;';
        cb.addEventListener('change', function () {
          if (cb.checked) {
            checked.push(svc.id);
          } else {
            var idx = checked.indexOf(svc.id);
            if (idx > -1) checked.splice(idx, 1);
          }
        });

        var info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML =
          '<div style="font-weight:600;font-size:0.9rem;">' + escapeHtml(svc.name) + '</div>' +
          (svc.description ? '<div style="font-size:0.78rem;color:var(--text-muted);">' + escapeHtml(svc.description) + '</div>' : '');

        var rateSpan = document.createElement('div');
        rateSpan.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:700;color:var(--primary-text);font-size:0.9rem;';
        rateSpan.textContent = svc.defaultRate > 0 ? '$' + formatMoney(svc.defaultRate) : '';

        row.appendChild(cb);
        row.appendChild(info);
        if (svc.defaultRate > 0) row.appendChild(rateSpan);
        listEl.appendChild(row);
      });

      saveBtn.onclick = async function () {
        if (checked.length === 0) {
          showToast('Select at least one service', 'info');
          return;
        }
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Adding...';
          await window.api.assignClientServices(clientId, checked);
          showToast('Services added to scope', 'success');
          overlay.remove();
          if (onSave) await onSave();
        } catch (err) {
          showToast(err.message || 'Failed to add services', 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Add Selected';
        }
      };
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div style="color:var(--danger);">Failed to load services.</div>';
    }
  }

  loadServices();
}

// ======================================================
// ADMIN: MANAGE SERVICE PRESETS MODAL
// ======================================================
function openManageServicesModal(onSave, { onClose } = {}) {
  var existing = document.getElementById('manageServicesOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'manageServicesOverlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,0.5);' +
    'display:flex;align-items:center;justify-content:center;' +
    'z-index:20000;padding:16px;';

  overlay.innerHTML =
    '<div style="' +
      'position:relative;width:min(600px,100%);max-height:85vh;overflow-y:auto;' +
      'background:var(--surface);' +
      'border:1px solid var(--border-soft);border-radius:18px;' +
      'padding:24px;box-shadow: var(--shadow-lift);color:var(--text-main);' +
    '">' +
      '<button type="button" id="closeManageServices" class="close-x" aria-label="Close">&times;</button>' +
      '<div style="font-size:0.75rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px;">Admin</div>' +
      '<h3 style="margin:0 0 4px;font-size:1.1rem;">Manage Service Presets</h3>' +
      '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 16px;">Add, edit, or remove global service options.</p>' +

      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<input id="newSvcName" type="text" placeholder="Service name (e.g. Mowing)"' +
          ' style="flex:1;min-width:0;">' +
        '<input id="newSvcRate" type="text" inputmode="decimal" placeholder="Rate"' +
          ' style="width:110px;">' +
        '<button id="addSvcBtn" class="btn-primary">Add</button>' +
      '</div>' +

      '<div id="manageServicesList" style="display:flex;flex-direction:column;gap:6px;">' +
        '<div style="color:var(--text-muted);">Loading...</div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button id="manageServicesDoneBtn" class="btn-primary btn-quiet" style="flex:1;">Done</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  function closeManage() {
    overlay.remove();
    if (onClose) onClose();
  }
  overlay._requestClose = closeManage;
  overlay.querySelector('#closeManageServices').onclick = closeManage;
  overlay.querySelector('#manageServicesDoneBtn').onclick = closeManage;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeManage(); });

  var listEl = overlay.querySelector('#manageServicesList');
  var nameInput = overlay.querySelector('#newSvcName');
  var rateInput = overlay.querySelector('#newSvcRate');
  var addBtn = overlay.querySelector('#addSvcBtn');

  // Apply money behavior to rate input
  applyMoneyInputBehavior(rateInput);

  async function loadServiceList() {
    listEl.innerHTML = '<div style="color:var(--text-muted);">Loading...</div>';
    try {
      var data = await window.api.listServices(true);
      var services = data.services || [];
      listEl.innerHTML = '';

      if (services.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted);">No service presets yet. Add one above.</div>';
        return;
      }

      services.forEach(function (svc) {
        var row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:8px;padding:10px 12px;' +
          'border-radius:10px;border:1px solid var(--border-soft);' +
          'background:var(--surface-muted);';

        var info = document.createElement('div');
        info.style.cssText = 'flex:1;min-width:0;';
        info.innerHTML =
          '<div style="font-weight:600;font-size:0.9rem;">' + escapeHtml(svc.name) +
            (svc.isActive ? '' : ' <span style="color:var(--danger);font-size:0.75rem;">(inactive)</span>') +
          '</div>' +
          (svc.description ? '<div style="font-size:0.78rem;color:var(--text-muted);">' + escapeHtml(svc.description) + '</div>' : '');

        var rateSpan = document.createElement('div');
        rateSpan.style.cssText = 'font-variant-numeric:tabular-nums;font-weight:700;color:var(--primary-text);font-size:0.9rem;padding:0 8px;';
        rateSpan.textContent = svc.defaultRate > 0 ? '$' + formatMoney(svc.defaultRate) : '';

        var toggleActiveBtn = document.createElement('button');
        toggleActiveBtn.textContent = svc.isActive ? 'Deactivate' : 'Activate';
        toggleActiveBtn.type = 'button';
        toggleActiveBtn.className = 'btn-secondary btn-sm';
        toggleActiveBtn.onclick = async function () {
          try {
            await window.api.updateService(svc.id, { isActive: !svc.isActive });
            await loadServiceList();
          } catch (err) {
            showToast('Failed to update service', 'error');
          }
        };

        var editBtn = document.createElement('button');
        editBtn.textContent = 'Edit';
        editBtn.type = 'button';
        editBtn.className = 'btn-secondary btn-sm';

        editBtn.onclick = function () {
          (async function () {
            var newName = await customPrompt('Service name:', svc.name);
            if (newName && newName.trim()) {
              try {
                await window.api.updateService(svc.id, { name: newName.trim() });
                await loadServiceList();
                showToast('Service updated', 'success');
              } catch (err) {
                showToast('Failed to update', 'error');
              }
            }
          })();
        };

        var delBtn = document.createElement('button');
        delBtn.textContent = 'Delete';
        delBtn.type = 'button';
        delBtn.className = 'btn-danger btn-sm';
        delBtn.onclick = async function () {
          if (!confirm('Delete "' + svc.name + '" permanently?')) return;
          try {
            await window.api.deleteService(svc.id);
            await loadServiceList();
            showToast('Service deleted', 'success');
          } catch (err) {
            showToast('Failed to delete', 'error');
          }
        };

        row.appendChild(info);
        row.appendChild(rateSpan);
        row.appendChild(toggleActiveBtn);
        row.appendChild(editBtn);
        row.appendChild(delBtn);
        listEl.appendChild(row);
      });
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div style="color:var(--danger);">Failed to load services.</div>';
    }
  }

  addBtn.onclick = async function () {
    var name = nameInput.value.trim();
    if (!name) { showToast('Enter a service name', 'error'); return; }
    var rate = parseMoney(rateInput.value) || 0;
    try {
      addBtn.disabled = true;
      addBtn.textContent = 'Adding...';
      await window.api.createService({ name: name, defaultRate: rate });
      nameInput.value = '';
      rateInput.value = '';
      showToast('Service added', 'success');
      await loadServiceList();
    } catch (err) {
      showToast(err.message || 'Failed to add service', 'error');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = 'Add';
    }
  };

  nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') addBtn.click();
  });

  loadServiceList();
}

// ======================================================
// JOB WORKSPACE (+ Job) — where the detailed work for one job happens:
// status, money (total, cost, profit, margin, payments), services & scope of
// work, documents/PDFs, photos, notes and tags.
//
// Closing it — the X, Escape, or clicking outside — saves everything first
// (fields, a typed-but-unsubmitted payment, an unsent note, a half-filled
// line item, an open note edit). If a save fails the workspace stays open,
// so nothing typed is ever lost.
// ======================================================
const JOB_STATUSES = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];

// Job schedule dates are calendar dates ("YYYY-MM-DD") with no time zone.
function scheduleDate(value) {
  return value ? String(value).slice(0, 10) : '';
}
// "Oct 10 – Oct 12, 2026 (3 days)" for a start date and a number of days.
function scheduleRangeText(start, days) {
  const first = new Date(start + 'T00:00:00Z');
  if (Number.isNaN(first.getTime())) return '';
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + Number(days) - 1);
  const fmt = (d, withYear) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
  const span = Number(days) === 1 ? fmt(first, true) : `${fmt(first, false)} – ${fmt(last, true)}`;
  return `${span} (${days} day${Number(days) === 1 ? '' : 's'})`;
}
const JOB_LINE_ITEM_CATEGORIES = ['Labor', 'Materials', 'Commissions', 'Meals/Drinks', 'Miscellaneous', 'Permits'];
const DEFAULT_SERVICE_CATEGORY = 'Labor';

// "1690000000000-signed-estimate.pdf" -> "signed-estimate.pdf"
function clientFileDisplayName(name) {
  return String(name || '').replace(/^\d{10,}-/, '');
}

// Renders client-level files (the older per-client PDF drop box) as rows
// with View / Download / Delete. Used by the client account and inside every
// job's Documents section, so those files stay reachable after the redesign.
function renderClientFileRows(container, clientId, files, onChanged) {
  container.innerHTML = '';
  (files || []).forEach(file => {
    const viewUrl = file.viewUrl || file.url;
    const downloadUrl = file.downloadUrl || file.url;
    const row = document.createElement('div');
    row.className = 'job-file-row';
    row.innerHTML = `
      <a href="${escapeHtml(viewUrl)}" target="_blank" rel="noopener" class="job-file-name"><i data-lucide="file-text"></i> ${escapeHtml(clientFileDisplayName(file.name))}</a>
      <a href="${escapeHtml(downloadUrl)}" class="job-file-action" download>Download</a>
      <button type="button" class="job-file-delete-btn" title="Delete file" aria-label="Delete ${escapeHtml(clientFileDisplayName(file.name))}">&times;</button>
    `;
    row.querySelector('.job-file-delete-btn').addEventListener('click', async () => {
      if (!confirm(`Delete "${clientFileDisplayName(file.name)}" permanently?`)) return;
      try {
        await window.api.deletePDF(clientId, file.name);
        if (onChanged) await onChanged();
      } catch (err) {
        console.error(err);
        showToast('Failed to delete file', 'error');
      }
    });
    container.appendChild(row);
  });
  if (window.lucide) window.lucide.createIcons();
}

// Picker for the company's service presets. Resolves the chosen presets via
// onConfirm(services); the picker closes once onConfirm succeeds.
function openServicePresetPicker({ heading = 'Add services', confirmLabel = 'Add Selected', onConfirm }) {
  const existing = document.getElementById('servicePresetPickerOverlay');
  if (existing) existing.remove();
  const admin = isAdminUser();

  const picker = document.createElement('div');
  picker.id = 'servicePresetPickerOverlay';
  picker.className = 'picker-overlay';
  picker.innerHTML = `
    <div class="picker-card" role="dialog" aria-modal="true" aria-labelledby="presetPickerHeading">
      <button type="button" class="job-modal-close" data-picker-close aria-label="Close">&times;</button>
      <div class="job-modal-kicker">Services</div>
      <h3 id="presetPickerHeading" class="picker-heading">${escapeHtml(heading)}</h3>
      <div class="picker-list" id="presetPickerList"><div class="field-hint">Loading services...</div></div>
      <div class="picker-actions">
        <button type="button" class="btn-primary" id="presetPickerConfirm">${escapeHtml(confirmLabel)}</button>
        ${admin ? '<button type="button" class="btn-primary btn-quiet" id="presetPickerManage">Manage Presets</button>' : ''}
        <button type="button" class="btn-primary btn-quiet" data-picker-close>Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(picker);

  const listEl = picker.querySelector('#presetPickerList');
  const confirmBtn = picker.querySelector('#presetPickerConfirm');
  let services = [];

  const close = () => picker.remove();
  picker._requestClose = close;
  picker.querySelectorAll('[data-picker-close]').forEach(b => { b.onclick = close; });
  picker.addEventListener('click', (e) => { if (e.target === picker) close(); });

  async function load() {
    listEl.innerHTML = '<div class="field-hint">Loading services...</div>';
    try {
      const data = await window.api.listServices();
      services = data.services || [];
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="field-hint" style="color:var(--danger);">Failed to load services.</div>';
      return;
    }
    if (!services.length) {
      listEl.innerHTML = `<div class="field-hint">No services set up yet.${admin ? ' Use “Manage Presets” to add your services and rates.' : ' Ask an admin to add service presets.'}</div>`;
      return;
    }
    listEl.innerHTML = services.map(svc => `
      <label class="picker-row">
        <input type="checkbox" value="${svc.id}">
        <span class="picker-row-text">
          <span class="picker-row-name">${escapeHtml(svc.name)}</span>
          ${svc.description ? `<span class="picker-row-desc">${escapeHtml(svc.description)}</span>` : ''}
        </span>
        ${svc.defaultRate > 0 ? `<span class="picker-row-rate">$${formatMoney(svc.defaultRate)}</span>` : ''}
      </label>`).join('');
  }

  confirmBtn.onclick = async () => {
    const ids = [...listEl.querySelectorAll('input[type="checkbox"]:checked')].map(cb => Number(cb.value));
    const chosen = services.filter(s => ids.includes(Number(s.id)));
    if (!chosen.length) {
      showToast('Select at least one service', 'info');
      return;
    }
    confirmBtn.disabled = true;
    try {
      await onConfirm(chosen);
      close();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to add services', 'error');
      confirmBtn.disabled = false;
    }
  };

  const manageBtn = picker.querySelector('#presetPickerManage');
  if (manageBtn) manageBtn.onclick = () => openManageServicesModal(load, { onClose: load });

  load();
}

function openJobPanel(job, clientId, onSave) {
  const existing = document.getElementById('jobPanelOverlay');
  if (existing) existing.remove();

  const admin = isAdminUser();
  const tags = Array.isArray(job.tags) ? job.tags : [];
  const clientName = (activeClient && Number(activeClient.id) === Number(clientId) && activeClient.name) || '';
  let current = { ...job };
  let lineItems = [];
  let lineItemsLoaded = false;
  let paymentHistory = { supported: false, payments: [] };
  const sessionPayments = [];   // payments added while open — undo fallback before payments.job_id exists
  const pending = new Set();    // in-flight saves (line item edits, payments)
  let closing = false;
  let userEdited = false;
  let notesApi = null;
  let expenseState = { supported: false, loaded: false, message: '', expenses: [], breakdown: [], categories: [] };
  // Scheduling (v9): the job row only has these columns once the database
  // update has been run; before that the fields are simply not shown.
  const scheduleSupported = Object.prototype.hasOwnProperty.call(job, 'scheduled_start');

  const panel = document.createElement('div');
  panel.id = 'jobPanelOverlay';
  panel.className = 'job-modal-overlay';
  panel.innerHTML = `
    <div id="jobPanelCard" class="job-modal-card job-workspace" role="dialog" aria-modal="true" aria-label="Job details">
      <button id="closeJobPanel" class="job-modal-close" aria-label="Save and close" title="Save and close">&times;</button>
      <div class="job-workspace-top">
        <div class="job-modal-kicker">Job${clientName ? ' · ' + escapeHtml(clientName) : ''}</div>
        <span id="jobSaveStatus" class="save-status-chip">Saved</span>
      </div>

      <div class="job-modal-field">
        <input id="job-title" type="text" class="job-title-input" aria-label="Job name" maxlength="200" value="${escapeHtml(job.title || 'New Job')}">
      </div>

      <div class="job-head-grid">
        <div class="job-modal-field">
          <label for="job-status">Status</label>
          <select id="job-status">
            ${JOB_STATUSES.map(s => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        ${scheduleSupported ? `
        <div class="job-modal-field" data-schedule-field hidden>
          <label for="job-start">Estimated start date</label>
          <input id="job-start" type="date" value="${escapeHtml(scheduleDate(job.scheduled_start))}">
        </div>
        <div class="job-modal-field" data-schedule-field hidden>
          <label for="job-duration">Job duration</label>
          <div class="job-duration-row">
            <input id="job-duration" type="number" min="1" max="365" step="1" inputmode="numeric" value="${job.duration_days ? Number(job.duration_days) : ''}" aria-describedby="job-schedule-hint">
            <span>days</span>
          </div>
        </div>` : ''}
        <div class="job-modal-field">
          <label>Created</label>
          <div class="job-modal-readout">${formatShortDate(job.created_at) || '—'}</div>
        </div>
        <div class="job-modal-field job-tags-field">
          <label for="job-tag-input">Tags</label>
          <div id="job-tags-list" class="job-tags-list"></div>
          <input id="job-tag-input" type="text" placeholder="Add a tag, press Enter" maxlength="40">
        </div>
      </div>
      ${scheduleSupported ? '<p class="field-hint job-schedule-hint" id="job-schedule-hint" role="status"></p>' : ''}

      <section class="job-section" aria-labelledby="jobMoneyHeading">
        <h4 class="job-section-title" id="jobMoneyHeading">Money</h4>
        <div class="job-money-tiles">
          <div class="total-tile"><span class="total-tile-label">Job Total</span><strong class="total-tile-value" id="job-total-display">$0.00</strong></div>
          <div class="total-tile"><span class="total-tile-label">Received</span><strong class="total-tile-value" id="job-paid-display">$0.00</strong></div>
          <div class="total-tile" id="job-balance-tile"><span class="total-tile-label">Balance</span><strong class="total-tile-value" id="job-balance-display">$0.00</strong></div>
          ${admin ? `
          <div class="total-tile is-readonly" title="Calculated from Job Costs — add or change costs there"><span class="total-tile-label">Cost</span><strong class="total-tile-value" id="job-cost-display">$0.00</strong><span class="total-tile-sub" id="job-cost-source">From Job Costs</span></div>
          <div class="total-tile"><span class="total-tile-label">Profit</span><strong class="total-tile-value" id="job-profit-display">$0.00</strong><span class="total-tile-sub" id="job-margin-display"></span></div>` : ''}
        </div>
        ${admin ? `
        <div class="job-money-inputs">
          <div class="job-modal-field">
            <label for="job-total">Job Total (revenue)</label>
            <input id="job-total" type="text" inputmode="decimal" value="${formatMoney(job.total_due)}">
            <span class="field-hint" id="job-total-hint"></span>
          </div>
          <div class="job-modal-field" id="job-cost-field" hidden>
            <label for="job-cost">Job Cost</label>
            <input id="job-cost" type="text" inputmode="decimal" value="${formatMoney(job.job_cost)}">
            <span class="field-hint" id="job-cost-hint">Itemized job costs need the one-time database update. Until then, enter the job's cost here.</span>
          </div>
        </div>
        <div class="job-modal-field">
          <label for="job-payment-input">Record a payment</label>
          <div class="job-payment-row">
            <input id="job-payment-input" type="text" inputmode="decimal" placeholder="Amount received">
            <button type="button" id="job-add-payment-btn" class="btn-primary">Add Payment</button>
            <button type="button" id="job-undo-payment-btn" class="btn-primary btn-quiet">Undo last payment</button>
          </div>
          <div id="job-payments-list" class="job-payments-list"></div>
        </div>` : '<p class="field-hint">Only admins can change the total or record payments.</p>'}
      </section>

      ${admin ? `
      <section class="job-section" id="job-costs-section" aria-labelledby="jobCostsHeading">
        <div class="job-section-head">
          <h4 class="job-section-title" id="jobCostsHeading">Job Costs</h4>
          <a href="/settings?tab=expenses" class="job-section-link" target="_blank" rel="noopener">Manage categories</a>
        </div>
        <div id="job-expenses-body"><div class="field-hint">Loading costs...</div></div>
      </section>` : ''}

      <section class="job-section" aria-labelledby="jobServicesHeading">
        <h4 class="job-section-title" id="jobServicesHeading">Services &amp; Scope of Work</h4>
        <div id="job-line-items-list" class="job-services-list"><div class="field-hint">Loading services...</div></div>
        <div class="job-services-actions">
          <button type="button" id="job-add-service-btn" class="btn-primary">+ Service</button>
          ${admin ? '<button type="button" id="job-add-line-btn" class="btn-primary btn-quiet">+ Custom line item</button>' : ''}
        </div>
        ${admin ? `
        <div id="job-line-item-form" class="job-line-item-add-grid" hidden>
          <input id="li-description" type="text" placeholder="Description" aria-label="Line item description">
          <select id="li-category" aria-label="Line item category">
            ${JOB_LINE_ITEM_CATEGORIES.map(c => `<option value="${c}" ${c === DEFAULT_SERVICE_CATEGORY ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <input id="li-quantity" type="text" inputmode="decimal" placeholder="Qty" value="1" aria-label="Quantity">
          <input id="li-unit-price" type="text" inputmode="decimal" placeholder="Price" aria-label="Unit price">
          <button type="button" id="li-add-btn" class="btn-primary">Add</button>
        </div>` : ''}
        <div class="job-modal-field">
          <label for="job-scope">Scope of work</label>
          <textarea id="job-scope" rows="4" placeholder="Describe the work for this job...">${escapeHtml(job.scope_of_work || '')}</textarea>
          <span class="field-hint">This is what the customer sees on the estimate and invoice. “+ Service” adds each service here; quantities, prices and categories stay internal. If left blank, the services above are listed instead.</span>
        </div>
      </section>

      <section class="job-section job-files-field" aria-labelledby="jobDocsHeading">
        <h4 class="job-section-title" id="jobDocsHeading">Documents &amp; PDFs</h4>
        <div id="job-documents-list" class="job-files-list"></div>
        <div class="job-files-upload-row job-dropzone" id="job-documents-dropzone">
          <input type="file" id="job-documents-input" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf">
          <span class="job-dropzone-text">Drag &amp; drop PDFs or documents here, or</span>
          <button type="button" id="job-documents-upload-btn" class="panel-secondary-btn">Upload Document / PDF</button>
        </div>
        <div id="job-documents-progress" class="job-file-progress" hidden>
          <div class="job-file-progress-track"><div class="job-file-progress-bar"></div></div>
          <span class="job-file-progress-label"></span>
        </div>
        <div id="job-client-files" class="job-client-files" hidden></div>
      </section>

      <section class="job-section job-files-field" aria-labelledby="jobPhotosHeading">
        <h4 class="job-section-title" id="jobPhotosHeading">Photos</h4>
        <div id="job-photos-list" class="job-files-list job-photos-grid"></div>
        <div class="job-files-upload-row job-dropzone" id="job-photos-dropzone">
          <input type="file" id="job-photos-input" multiple hidden accept="image/*">
          <span class="job-dropzone-text">Drag &amp; drop photos here, or</span>
          <button type="button" id="job-photos-upload-btn" class="panel-secondary-btn">Upload Photos</button>
        </div>
        <div id="job-photos-progress" class="job-file-progress" hidden>
          <div class="job-file-progress-track"><div class="job-file-progress-bar"></div></div>
          <span class="job-file-progress-label"></span>
        </div>
      </section>

      <section class="job-section job-notes-field" aria-labelledby="jobNotesHeading">
        <h4 class="job-section-title" id="jobNotesHeading">Notes</h4>
        <div id="job-notes-list" class="notes-list"></div>
        <div class="notes-actions">
          <textarea id="job-new-note-input" placeholder="Add a note..." rows="3" aria-label="New job note"></textarea>
          <button type="button" id="job-add-note-btn" class="btn-primary add-note-btn">Add Note</button>
        </div>
      </section>

      <div class="job-modal-actions">
        <button type="button" id="job-save-btn" class="btn-primary">Save Job</button>
        <button type="button" id="job-estimate-btn" class="btn-primary btn-quiet">Download Estimate</button>
        <button type="button" id="job-invoice-btn" class="btn-primary btn-quiet">Download Invoice</button>
        <button type="button" id="job-duplicate-btn" class="btn-primary btn-quiet" title="Copy this job's services, scope and cost into a new job — e.g. next month's maintenance">Duplicate</button>
        <button type="button" id="job-delete-btn" class="btn-primary btn-danger-soft">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = (sel) => panel.querySelector(sel);
  const titleEl = $('#job-title');
  const statusEl = $('#job-status');
  const scopeEl = $('#job-scope');
  const totalEl = $('#job-total');
  const costEl = $('#job-cost');
  const paymentEl = $('#job-payment-input');
  const noteInput = $('#job-new-note-input');
  const lineForm = $('#job-line-item-form');
  const startEl = $('#job-start');
  const durationEl = $('#job-duration');
  [totalEl, costEl, paymentEl, $('#li-unit-price')].forEach(el => applyMoneyInputBehavior(el));
  applyMoneyInputBehavior($('#li-quantity'), { decimals: 'auto' });

  function track(promise) {
    pending.add(promise);
    const done = () => { pending.delete(promise); refreshDirtyChip(); };
    promise.then(done, done);
    return promise;
  }

  // ---------- schedule (Approved jobs go on the Calendar) ----------
  // The schedule is part of the job: it is saved with the job's other fields
  // and the Calendar reads it from the job, so there is nothing separate to
  // create or keep in step. Dates are kept when the job leaves Approved and
  // come back on the calendar if it is approved again.
  function renderSchedule() {
    if (!startEl || !durationEl) return;
    const approved = statusEl.value === 'Approved';
    panel.querySelectorAll('[data-schedule-field]').forEach((el) => { el.hidden = !approved; });
    const hint = $('#job-schedule-hint');
    if (!hint) return;
    const start = startEl.value;
    const days = Number(durationEl.value);
    const range = start && days >= 1 ? scheduleRangeText(start, days) : '';
    if (approved) {
      hint.innerHTML = range
        ? `On the <a href="/calendar?date=${encodeURIComponent(start)}" target="_blank" rel="noopener">Calendar</a>: ${escapeHtml(range)}.`
        : 'Add an estimated start date and duration to put this job on the Calendar.';
    } else {
      hint.textContent = range
        ? `Scheduled ${range}. It shows on the Calendar while the job is Approved.`
        : 'Set the status to Approved to schedule this job on the Calendar.';
    }
  }

  // ---------- status chip ----------
  function setJobStatusChip(state) {
    const el = $('#jobSaveStatus');
    if (!el) return;
    const map = {
      saving: ['Saving…', 'var(--warning-text)'],
      error: ['Save failed', 'var(--danger-text)'],
      unsaved: ['Unsaved changes', 'var(--warning-text)'],
      saved: ['Saved', 'var(--success-text)']
    };
    const [text, color] = map[state] || map.saved;
    el.textContent = text;
    el.style.color = color;
  }

  // ---------- fields ----------
  function lineItemsTotal() {
    return lineItems.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  }
  function effectiveTotal() {
    if (lineItems.length) return lineItemsTotal();
    if (admin && totalEl) return parseMoney(totalEl.value) || 0;
    return Number(current.total_due || 0);
  }
  function collectFields() {
    const payload = {
      title: titleEl.value.trim() || 'New Job',
      status: statusEl.value,
      scope_of_work: scopeEl.value
    };
    if (startEl && durationEl) {
      payload.scheduled_start = startEl.value || null;
      payload.duration_days = durationEl.value.trim() === '' ? null : Number(durationEl.value);
    }
    if (admin) {
      if (!lineItems.length && totalEl) payload.total_due = parseMoney(totalEl.value) || 0;
      // The job's cost is controlled only by Job Costs (the server keeps
      // job_cost = their sum). The single Job Cost field is only offered
      // before the v7 migration, when there is no itemized list yet.
      if (costEl && costIsTyped()) payload.job_cost = parseMoney(costEl.value) || 0;
    }
    return payload;
  }
  // Last-saved values of the job's own fields, compared by value so key
  // order never matters.
  let savedFields = collectFields();
  function sameFields(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => String(a[k]) === String(b[k]));
  }

  function pendingPayment() {
    if (!paymentEl) return 0;
    const v = parseMoney(paymentEl.value);
    return v > 0 ? v : 0;
  }
  function lineDraft() {
    if (!lineForm || lineForm.hidden) return null;
    const description = $('#li-description').value.trim();
    const unitPrice = parseMoney($('#li-unit-price').value) || 0;
    if (!description && !unitPrice) return null;
    return {
      description: description || 'Line item',
      quantity: parseMoney($('#li-quantity').value) || 1,
      unit_price: unitPrice,
      category: $('#li-category').value
    };
  }
  function openNoteEdits() {
    return [...panel.querySelectorAll('textarea.job-note-edit-textarea')]
      .filter(ta => ta.dataset.noteId && ta.value.trim() && ta.value.trim() !== (ta.dataset.original || ''));
  }
  function hasUnsavedWork() {
    return !sameFields(collectFields(), savedFields) ||
      pendingPayment() > 0 ||
      Boolean(noteInput && noteInput.value.trim()) ||
      Boolean(lineDraft()) ||
      Boolean(expenseDraft()) ||
      openNoteEdits().length > 0;
  }
  function refreshDirtyChip() {
    if (closing) return;
    setJobStatusChip(pending.size ? 'saving' : (hasUnsavedWork() ? 'unsaved' : 'saved'));
  }

  // ---------- money ----------
  function renderMoney() {
    const total = effectiveTotal();
    const paid = Number(current.amount_paid || 0);
    const balance = total - paid;
    const set = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
    set('#job-total-display', '$' + formatMoney(total));
    set('#job-paid-display', '$' + formatMoney(paid));
    set('#job-balance-display', '$' + formatMoney(balance));
    const balanceTile = $('#job-balance-tile');
    if (balanceTile) balanceTile.classList.toggle('is-due', balance > 0.005);
    if (admin) {
      const cost = costEl && costIsTyped() ? (parseMoney(costEl.value) || 0) : Number(current.job_cost || 0);
      const profit = total - cost;
      set('#job-cost-display', '$' + formatMoney(cost));
      set('#job-profit-display', '$' + formatMoney(profit));
      set('#job-margin-display', total > 0 ? `Margin ${Math.round((profit / total) * 100)}%` : 'Margin —');
      const costField = $('#job-cost-field');
      if (costField) costField.hidden = !costIsTyped();
      set('#job-cost-source', costIsTyped() ? 'Entered below' : 'From Job Costs');
      if (totalEl) {
        const fromServices = lineItems.length > 0;
        totalEl.readOnly = fromServices;
        totalEl.classList.toggle('is-computed', fromServices);
        if (fromServices && document.activeElement !== totalEl) totalEl.value = formatMoney(total);
        const hint = $('#job-total-hint');
        if (hint) {
          hint.textContent = fromServices
            ? 'Calculated from the services below.'
            : 'Type a total, or add services below to calculate it.';
        }
      }
    }
  }
  // The server recalculates the job total whenever its services change, so
  // mirror that here: update the Job Total field too (it would otherwise keep
  // the old services total after the last service is removed) and record
  // the new total as already saved.
  function syncTotalFromServices() {
    const total = lineItemsTotal();
    current.total_due = total;
    current.balance = total - Number(current.amount_paid || 0);
    if (totalEl) totalEl.value = formatMoney(total);
    const now = collectFields();
    if ('total_due' in now) savedFields.total_due = now.total_due;
    else delete savedFields.total_due;
    renderMoney();
  }

  // ---------- payments (admin) ----------
  async function recordPayment(amount) {
    const res = await window.api.addJobPayment(current.id, amount);
    current = { ...current, ...res.job };
    sessionPayments.push(amount);
    if (paymentEl) paymentEl.value = '';
    renderMoney();
    triggerFinanceUpdate();
    loadPayments();
  }

  function lastUndoablePayment() {
    if (paymentHistory.supported && paymentHistory.payments.length) {
      const ordered = paymentHistory.payments.slice()
        .sort((a, b) => new Date(a.payment_date) - new Date(b.payment_date) || a.id - b.id);
      const stack = [];
      ordered.forEach(p => {
        if (p.amount > 0) {
          stack.push(p.amount);
        } else {
          const idx = stack.lastIndexOf(-p.amount);
          if (idx >= 0) stack.splice(idx, 1); else stack.pop();
        }
      });
      if (stack.length) return stack[stack.length - 1];
    }
    return sessionPayments.length ? sessionPayments[sessionPayments.length - 1] : 0;
  }

  async function loadPayments() {
    const list = $('#job-payments-list');
    if (!admin || !list) return;
    paymentHistory = await window.api.listJobPayments(current.id);
    const rows = paymentHistory.supported ? paymentHistory.payments : [];
    const ledgerSum = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
    const earlier = Number(current.amount_paid || 0) - ledgerSum;
    const items = rows.map(p => `
      <div class="job-payment-item${p.amount < 0 ? ' is-correction' : ''}">
        <span>${formatShortDate(p.payment_date)}</span>
        <span>${p.amount < 0 ? 'Correction' : 'Payment'}</span>
        <strong>${p.amount < 0 ? '−' : ''}$${formatMoney(Math.abs(p.amount))}</strong>
      </div>`);
    if (paymentHistory.supported && earlier > 0.005) {
      items.push(`<div class="job-payment-item"><span>Earlier</span><span>Recorded before payment history</span><strong>$${formatMoney(earlier)}</strong></div>`);
    }
    list.innerHTML = items.join('');
  }

  const addPaymentBtn = $('#job-add-payment-btn');
  if (addPaymentBtn) {
    addPaymentBtn.onclick = async () => {
      const amount = pendingPayment();
      if (!amount) { showToast('Enter a payment amount', 'error'); return; }
      addPaymentBtn.disabled = true;
      try {
        await track(recordPayment(amount));
        showToast(`Payment of $${formatMoney(amount)} recorded`, 'success');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to add payment', 'error');
      } finally {
        addPaymentBtn.disabled = false;
      }
    };
  }

  const undoPaymentBtn = $('#job-undo-payment-btn');
  if (undoPaymentBtn) {
    undoPaymentBtn.onclick = async () => {
      const amount = lastUndoablePayment();
      if (!amount) {
        showToast('No payment to undo', 'info');
        return;
      }
      if (!confirm(`Undo the $${formatMoney(amount)} payment?\n\nIt is recorded as a correction, so the payment history stays intact.`)) return;
      undoPaymentBtn.disabled = true;
      try {
        const res = await track(window.api.reverseJobPayment(current.id, amount));
        current = { ...current, ...res.job };
        if (!paymentHistory.supported) sessionPayments.pop();
        renderMoney();
        triggerFinanceUpdate();
        await loadPayments();
        showToast('Payment undone', 'success');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to undo payment', 'error');
      } finally {
        undoPaymentBtn.disabled = false;
      }
    };
  }

  // ---------- scope of work ----------
  // Services added with “+ Service” are part of the scope of work: each one
  // is written into the scope text as "- Service name" (what the customer
  // sees on the estimate/invoice), while its quantity, price and category
  // stay on the business side.
  function scopeLineFor(name) {
    return `- ${String(name || '').trim()}`;
  }
  function scopeHasLine(line) {
    return scopeEl.value.split(/\r?\n/).some(l => l.trim().toLowerCase() === line.toLowerCase());
  }
  function addToScope(names) {
    const lines = names.map(scopeLineFor).filter(l => l !== '- ' && !scopeHasLine(l));
    if (!lines.length) return false;
    const base = scopeEl.value.replace(/\s+$/, '');
    scopeEl.value = base ? base + '\n' + lines.join('\n') : lines.join('\n');
    return true;
  }
  function removeFromScope(name) {
    const target = scopeLineFor(name).toLowerCase();
    const lines = scopeEl.value.split(/\r?\n/);
    const idx = lines.findIndex(l => l.trim().toLowerCase() === target);
    if (idx < 0) return false;
    lines.splice(idx, 1);
    scopeEl.value = lines.join('\n');
    return true;
  }
  function renameInScope(oldName, newName) {
    const target = scopeLineFor(oldName).toLowerCase();
    const lines = scopeEl.value.split(/\r?\n/);
    const idx = lines.findIndex(l => l.trim().toLowerCase() === target);
    if (idx < 0 || !String(newName || '').trim()) return false;
    lines[idx] = scopeLineFor(newName);
    scopeEl.value = lines.join('\n');
    return true;
  }
  // Saves the job's fields right away after a service action changed the
  // scope, so the scope and the services never drift apart.
  function saveScopeNow() {
    userEdited = true;
    const payload = collectFields();
    return track((async () => {
      const res = await window.api.updateJob(current.id, payload);
      current = { ...current, ...res.job };
      savedFields = payload;
    })()).catch((err) => {
      console.error(err);
      refreshDirtyChip();
    });
  }

  // ---------- services (line items) ----------
  function renderLineItems() {
    const list = $('#job-line-items-list');
    if (!list) return;
    if (!lineItems.length) {
      list.innerHTML = `<div class="field-hint">No services yet. Use “+ Service” to add work from your service list${admin ? ', or add a custom line item' : ''}.</div>`;
      return;
    }
    if (admin) {
      list.innerHTML = `
        <div class="job-services-table">
          <div class="job-services-head" aria-hidden="true"><span>Service</span><span>Category</span><span>Qty</span><span>Price</span><span>Amount</span><span></span></div>
          ${lineItems.map(i => `
          <div class="job-service-row" data-id="${i.id}">
            <input class="li-edit" data-field="description" value="${escapeHtml(i.description)}" aria-label="Service description" maxlength="500">
            <select class="li-edit" data-field="category" aria-label="Category for ${escapeHtml(i.description)}">
              ${JOB_LINE_ITEM_CATEGORIES.map(c => `<option value="${c}" ${c === i.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
            <input class="li-edit li-num" data-field="quantity" inputmode="decimal" value="${Number(i.quantity)}" aria-label="Quantity for ${escapeHtml(i.description)}">
            <input class="li-edit li-num" data-field="unit_price" inputmode="decimal" value="${formatMoney(i.unit_price)}" aria-label="Price for ${escapeHtml(i.description)}">
            <span class="li-amount">$${formatMoney(Number(i.quantity) * Number(i.unit_price))}</span>
            <button type="button" class="li-remove" data-id="${i.id}" aria-label="Remove ${escapeHtml(i.description)}" title="Remove">&times;</button>
          </div>`).join('')}
          <div class="job-services-total">Services total <strong id="job-services-total">$${formatMoney(lineItemsTotal())}</strong></div>
        </div>`;
      list.querySelectorAll('[data-field="unit_price"]').forEach(el => applyMoneyInputBehavior(el));
      list.querySelectorAll('[data-field="quantity"]').forEach(el => applyMoneyInputBehavior(el, { decimals: 'auto' }));
    } else {
      list.innerHTML = `
        <div class="job-services-table is-readonly">
          ${lineItems.map(i => `
          <div class="job-service-row">
            <span class="li-desc">${escapeHtml(i.description || '(no description)')}</span>
            <span class="li-qty">${Number(i.quantity)} × $${formatMoney(i.unit_price)}</span>
            <span class="li-amount">$${formatMoney(Number(i.quantity) * Number(i.unit_price))}</span>
          </div>`).join('')}
          <div class="job-services-total">Services total <strong>$${formatMoney(lineItemsTotal())}</strong></div>
        </div>`;
    }
  }

  async function loadLineItems() {
    try {
      const data = await window.api.listJobLineItems(current.id);
      lineItems = data.lineItems || [];
    } catch (err) {
      console.error(err);
      const list = $('#job-line-items-list');
      if (list) list.innerHTML = '<div class="field-hint" style="color:var(--danger);">Failed to load services.</div>';
      return;
    }
    lineItemsLoaded = true;
    renderLineItems();
    renderMoney();
    if (!userEdited) savedFields = collectFields();
    refreshDirtyChip();
  }

  async function addLineItems(items) {
    if (!lineItemsLoaded) await loadLineItems();
    // The first time services are added, don't silently drop a hand-entered
    // total: offer to keep it as its own line.
    if (!lineItems.length) {
      const manualTotal = totalEl ? parseMoney(totalEl.value) : Number(current.total_due || 0);
      if (manualTotal > 0.005) {
        const keep = confirm(
          `This job's total ($${formatMoney(manualTotal)}) was entered by hand. Once a job has services, its total is the sum of its services.\n\n` +
          `OK — keep $${formatMoney(manualTotal)} as its own line so the total doesn't drop.\n` +
          `Cancel — replace it with the services' prices.`
        );
        if (keep) {
          items = [{ description: 'Job total (entered before services)', quantity: 1, unit_price: manualTotal, category: 'Miscellaneous' }].concat(items);
        }
      }
    }
    const res = await track(window.api.addJobLineItemsBulk(current.id, items));
    lineItems = lineItems.concat(res.lineItems || []);
    renderLineItems();
    syncTotalFromServices();
    triggerFinanceUpdate();
  }

  const serviceList = $('#job-line-items-list');
  if (admin && serviceList) {
    // Live amounts while typing; saved when the field is left (change event).
    serviceList.addEventListener('input', (e) => {
      const input = e.target.closest('.li-edit');
      if (!input) return;
      const row = input.closest('.job-service-row');
      const item = lineItems.find(i => Number(i.id) === Number(row.dataset.id));
      if (!item || (input.dataset.field !== 'quantity' && input.dataset.field !== 'unit_price')) return;
      const qty = parseMoney(row.querySelector('[data-field="quantity"]').value);
      const price = parseMoney(row.querySelector('[data-field="unit_price"]').value);
      row.querySelector('.li-amount').textContent = '$' + formatMoney(qty * price);
      const draftTotal = lineItems.reduce((s, i) => s + (i === item ? qty * price : Number(i.quantity) * Number(i.unit_price)), 0);
      const totalOut = $('#job-services-total');
      if (totalOut) totalOut.textContent = '$' + formatMoney(draftTotal);
    });

    serviceList.addEventListener('change', (e) => {
      const input = e.target.closest('.li-edit');
      if (!input) return;
      const row = input.closest('.job-service-row');
      const id = Number(row.dataset.id);
      const item = lineItems.find(i => Number(i.id) === id);
      if (!item) return;
      const field = input.dataset.field;
      let value = input.value;
      if (field === 'quantity' || field === 'unit_price') value = parseMoney(value);
      if (field === 'description') value = value.trim();
      if (String(item[field]) === String(value)) return;
      track((async () => {
        try {
          const previousDescription = item.description;
          const res = await window.api.updateJobLineItem(current.id, id, { [field]: value });
          const idx = lineItems.findIndex(i => Number(i.id) === id);
          if (idx >= 0) lineItems[idx] = res.lineItem;
          if (field === 'description' && renameInScope(previousDescription, res.lineItem.description)) saveScopeNow();
          syncTotalFromServices();
          if (field === 'unit_price') input.value = formatMoney(res.lineItem.unit_price);
          const totalOut = $('#job-services-total');
          if (totalOut) totalOut.textContent = '$' + formatMoney(lineItemsTotal());
          triggerFinanceUpdate();
        } catch (err) {
          console.error(err);
          showToast(err.message || 'Failed to update service', 'error');
          renderLineItems();
          throw err;
        }
      })()).catch(() => {});
    });

    serviceList.addEventListener('click', async (e) => {
      const btn = e.target.closest('.li-remove');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const item = lineItems.find(i => Number(i.id) === id);
      if (!confirm(`Remove "${(item && item.description) || 'this service'}" from this job?`)) return;
      try {
        await track(window.api.deleteJobLineItem(current.id, id));
        lineItems = lineItems.filter(i => Number(i.id) !== id);
        renderLineItems();
        syncTotalFromServices();
        // Its scope line goes too, unless another service of that name remains.
        const removedName = String((item && item.description) || '').trim().toLowerCase();
        if (removedName && !lineItems.some(i => String(i.description || '').trim().toLowerCase() === removedName)
          && removeFromScope(item.description)) saveScopeNow();
        triggerFinanceUpdate();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to remove service', 'error');
      }
    });
  }

  $('#job-add-service-btn').onclick = () => {
    openServicePresetPicker({
      heading: admin ? 'Add services to this job' : 'Add services to the scope of work',
      onConfirm: async (services) => {
        if (admin) {
          await addLineItems(services.map(s => ({
            description: s.name,
            quantity: 1,
            unit_price: Number(s.defaultRate || 0),
            category: DEFAULT_SERVICE_CATEGORY
          })));
          if (addToScope(services.map(s => s.name))) await saveScopeNow();
          showToast(`${services.length} service${services.length === 1 ? '' : 's'} added to the job and its scope of work`, 'success');
        } else {
          // Regular users can't set prices, so their services go into the
          // scope of work (saved with the job).
          addToScope(services.map(s => s.name));
          userEdited = true;
          refreshDirtyChip();
          showToast('Added to the scope of work', 'success');
        }
      }
    });
  };

  const addLineBtn = $('#job-add-line-btn');
  if (addLineBtn && lineForm) {
    addLineBtn.onclick = () => {
      lineForm.hidden = !lineForm.hidden;
      if (!lineForm.hidden) $('#li-description').focus();
    };
    $('#li-add-btn').onclick = async () => {
      const draft = lineDraft();
      if (!draft) { showToast('Enter a description or a price', 'error'); return; }
      const btn = $('#li-add-btn');
      btn.disabled = true;
      try {
        await addLineItems([draft]);
        $('#li-description').value = '';
        $('#li-quantity').value = '1';
        $('#li-unit-price').value = '';
        showToast('Line item added', 'success');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to add line item', 'error');
      } finally {
        btn.disabled = false;
        refreshDirtyChip();
      }
    };
  }

  // ---------- tags ----------
  const tagsListEl = $('#job-tags-list');
  const tagInput = $('#job-tag-input');
  let currentTags = tags.slice();
  function renderTags() {
    tagsListEl.innerHTML = currentTags.map((t) =>
      `<span class="job-tag-chip">${escapeHtml(t)}<button type="button" class="job-tag-remove" data-tag="${escapeHtml(t)}" aria-label="Remove tag ${escapeHtml(t)}">&times;</button></span>`
    ).join('');
    tagsListEl.querySelectorAll('.job-tag-remove').forEach((btn) => {
      btn.onclick = () => saveTags(currentTags.filter((t) => t !== btn.dataset.tag));
    });
  }
  async function saveTags(nextTags) {
    try {
      const result = await track(window.api.updateJobTags(current.id, nextTags));
      currentTags = (result.job && result.job.tags) || nextTags;
      renderTags();
    } catch (err) {
      console.error(err);
      showToast('Failed to update tags', 'error');
    }
  }
  if (tagInput) {
    tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = tagInput.value.trim();
      if (value && !currentTags.includes(value)) saveTags([...currentTags, value]);
      tagInput.value = '';
    });
  }
  renderTags();

  // ---------- client-level files inside Documents ----------
  async function renderClientFilesInJob() {
    const box = $('#job-client-files');
    if (!box) return;
    if (!activeClientFiles.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="job-client-files-title">Client files <span>— uploaded to the client before jobs; shared by all of this client's jobs</span></div>
      <div class="job-client-files-list"></div>`;
    renderClientFileRows(box.querySelector('.job-client-files-list'), clientId, activeClientFiles, async () => {
      try {
        activeClientFiles = (await window.api.listPDFs(clientId)).files || [];
      } catch (e) { /* keep the old list */ }
      renderClientFilesInJob();
    });
  }

  // ---------- job costs (itemized expenses with categories; admin) ----------
  // A job's itemized costs ARE its Job Cost: the server keeps jobs.job_cost
  // equal to their sum, so profit/margin/client totals use the same figure.
  function hasItemizedCosts() {
    return expenseState.supported && expenseState.expenses.length > 0;
  }
  // True only before the v7 migration (no itemized cost list exists), when
  // the single Job Cost field is still the way to enter a cost.
  function costIsTyped() {
    return expenseState.loaded && !expenseState.supported;
  }

  function activeCategories() {
    return expenseState.categories.filter(c => c.is_active);
  }

  function categoryOptions(selectedId, { allowUncategorized = false } = {}) {
    const opts = activeCategories().map(c =>
      `<option value="${c.id}" ${Number(selectedId) === Number(c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>`);
    // An expense in a since-deactivated category keeps showing it.
    const current = expenseState.categories.find(c => Number(c.id) === Number(selectedId));
    if (current && !current.is_active) {
      opts.push(`<option value="${current.id}" selected>${escapeHtml(current.name)} (inactive)</option>`);
    }
    if (allowUncategorized) {
      opts.push(`<option value="" ${selectedId === null || selectedId === undefined ? 'selected' : ''}>Uncategorized</option>`);
    }
    return opts.join('');
  }

  function expenseDraft() {
    if (!expenseState.supported) return null;
    const desc = $('#exp-description');
    const amount = $('#exp-amount');
    if (!desc || !amount) return null;
    const value = parseMoney(amount.value);
    if (!desc.value.trim() && !(value > 0)) return null;
    const cat = $('#exp-category');
    return {
      description: desc.value.trim() || 'Cost',
      amount: value || 0,
      category_id: cat && cat.value ? Number(cat.value) : null
    };
  }

  function renderExpenses() {
    const body = $('#job-expenses-body');
    if (!body) return;
    if (!expenseState.supported) {
      body.innerHTML = `<p class="field-hint">${escapeHtml(expenseState.message || 'Itemized costs are not available yet.')} Until then, enter the cost in Job Cost above.</p>`;
      return;
    }
    const { expenses, breakdown } = expenseState;
    const totalCost = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const breakdownHtml = expenses.length ? `
      <div class="job-cost-breakdown" aria-label="Costs by category">
        ${breakdown.map(b => `
          <div class="job-cost-cat">
            <span class="job-cost-cat-name">${escapeHtml(b.name)}${b.category_id !== null && !b.is_active ? ' <span class="job-cost-inactive">(inactive)</span>' : ''}</span>
            <strong>$${formatMoney(b.total)}</strong>
          </div>`).join('')}
        <div class="job-cost-cat job-cost-total"><span>Total Cost</span><strong id="job-costs-total">$${formatMoney(totalCost)}</strong></div>
      </div>` : (Number(current.job_cost || 0) > 0.005 ? `
      <div class="job-cost-legacy">
        <div class="job-cost-legacy-text">
          <strong>$${formatMoney(current.job_cost)}</strong> cost entered before itemized costs
          <span class="field-hint">It stays this job's cost and becomes an Uncategorized line when you add the first cost — or move it into the list now to edit or re-categorize it.</span>
        </div>
        <button type="button" id="exp-itemize-legacy-btn" class="btn-primary btn-quiet">Move into cost list</button>
      </div>` : '<p class="field-hint">No itemized costs yet. Add each cost with a description, amount and category — the job’s cost is their total.</p>');

    const rowsHtml = expenses.length ? `
      <div class="job-expenses-table">
        <div class="job-expenses-head" aria-hidden="true"><span>Cost</span><span>Category</span><span>Amount</span><span></span></div>
        ${expenses.map(e => `
        <div class="job-expense-row" data-id="${e.id}">
          <input class="exp-edit" data-field="description" value="${escapeHtml(e.description)}" maxlength="500" aria-label="Cost description">
          <select class="exp-edit" data-field="category_id" aria-label="Category for ${escapeHtml(e.description)}">${categoryOptions(e.category_id, { allowUncategorized: true })}</select>
          <input class="exp-edit exp-amount" data-field="amount" inputmode="decimal" value="${formatMoney(e.amount)}" aria-label="Amount for ${escapeHtml(e.description)}">
          <button type="button" class="exp-remove" data-id="${e.id}" aria-label="Remove ${escapeHtml(e.description)}" title="Remove">&times;</button>
        </div>`).join('')}
      </div>` : '';

    const hadDraft = {
      description: $('#exp-description') ? $('#exp-description').value : '',
      amount: $('#exp-amount') ? $('#exp-amount').value : '',
      category: $('#exp-category') ? $('#exp-category').value : ''
    };
    body.innerHTML = breakdownHtml + rowsHtml + `
      <div class="job-expense-add-grid">
        <input id="exp-description" type="text" placeholder="Cost (e.g. 40 bundles of shingles)" aria-label="New cost description" maxlength="500">
        <select id="exp-category" aria-label="New cost category">${categoryOptions(activeCategories()[0] ? activeCategories()[0].id : null, { allowUncategorized: !activeCategories().length })}</select>
        <input id="exp-amount" type="text" inputmode="decimal" placeholder="Amount" aria-label="New cost amount">
        <button type="button" id="exp-add-btn" class="btn-primary">Add Cost</button>
      </div>`;
    $('#exp-description').value = hadDraft.description;
    $('#exp-amount').value = hadDraft.amount;
    if (hadDraft.category && [...$('#exp-category').options].some(o => o.value === hadDraft.category)) {
      $('#exp-category').value = hadDraft.category;
    }
    applyMoneyInputBehavior($('#exp-amount'));
    body.querySelectorAll('.exp-amount').forEach(el => applyMoneyInputBehavior(el));
    $('#exp-add-btn').onclick = addDraftExpense;
    const itemizeBtn = $('#exp-itemize-legacy-btn');
    if (itemizeBtn) {
      itemizeBtn.onclick = async () => {
        itemizeBtn.disabled = true;
        try {
          applyExpenseResponse(await track(window.api.itemizeExistingJobCost(current.id)));
          triggerFinanceUpdate();
          showToast('The earlier cost is now an Uncategorized line you can edit', 'success');
        } catch (err) {
          console.error(err);
          showToast(err.message || 'Failed to move the cost', 'error');
          itemizeBtn.disabled = false;
        }
      };
    }
  }

  // Applies a server response (expenses, breakdown, categories and the
  // job's recalculated cost) and keeps the Job Cost field in step.
  function applyExpenseResponse(data) {
    expenseState = {
      ...expenseState,
      supported: data.supported !== false,
      message: data.message || '',
      loaded: true,
      expenses: data.expenses || [],
      breakdown: data.breakdown || [],
      categories: data.categories || expenseState.categories
    };
    if (data.job) {
      current.job_cost = Number(data.job.job_cost || 0);
    } else if (hasItemizedCosts()) {
      current.job_cost = expenseState.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    }
    if (costEl && document.activeElement !== costEl) {
      costEl.value = formatMoney(current.job_cost);
    }
    const now = collectFields();
    if ('job_cost' in now) savedFields.job_cost = now.job_cost;
    else delete savedFields.job_cost;
    renderExpenses();
    renderMoney();
    refreshDirtyChip();
  }

  async function loadExpenses() {
    if (!admin) return;
    try {
      applyExpenseResponse(await window.api.listJobExpenses(current.id));
    } catch (err) {
      console.error(err);
      const body = $('#job-expenses-body');
      if (body) body.innerHTML = '<div class="field-hint" style="color:var(--danger-text);">Failed to load job costs.</div>';
    }
  }

  async function addExpense(draft) {
    const hadTypedCost = !hasItemizedCosts() && Number(current.job_cost || 0) > 0.005;
    const typedCost = Number(current.job_cost || 0);
    const data = await track(window.api.addJobExpense(current.id, draft));
    applyExpenseResponse(data);
    triggerFinanceUpdate();
    if (hadTypedCost) {
      showToast(`The job's earlier cost of $${formatMoney(typedCost)} was kept as an Uncategorized cost.`, 'info', 4500);
    }
  }

  async function addDraftExpense() {
    const draft = expenseDraft();
    if (!draft) { showToast('Enter a cost description and amount', 'error'); return; }
    const btn = $('#exp-add-btn');
    if (btn) btn.disabled = true;
    try {
      await addExpense(draft);
      $('#exp-description').value = '';
      $('#exp-amount').value = '';
      showToast('Cost added', 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to add cost', 'error');
    } finally {
      const again = $('#exp-add-btn');
      if (again) again.disabled = false;
      refreshDirtyChip();
    }
  }

  const expensesBody = $('#job-expenses-body');
  if (expensesBody) {
    // Live Total Cost while an amount is being typed; saved on change.
    expensesBody.addEventListener('input', (e) => {
      const input = e.target.closest('.exp-amount');
      if (!input) return;
      const row = input.closest('.job-expense-row');
      const draftTotal = expenseState.expenses.reduce((s, x) =>
        s + (Number(x.id) === Number(row.dataset.id) ? parseMoney(input.value) : Number(x.amount || 0)), 0);
      const out = $('#job-costs-total');
      if (out) out.textContent = '$' + formatMoney(draftTotal);
    });

    expensesBody.addEventListener('change', (e) => {
      const input = e.target.closest('.exp-edit');
      if (!input) return;
      const row = input.closest('.job-expense-row');
      const id = Number(row.dataset.id);
      const expense = expenseState.expenses.find(x => Number(x.id) === id);
      if (!expense) return;
      const field = input.dataset.field;
      let value = input.value;
      if (field === 'amount') value = parseMoney(value);
      if (field === 'description') value = value.trim();
      if (field === 'category_id') value = value === '' ? null : Number(value);
      if (String(expense[field]) === String(value)) return;
      track((async () => {
        try {
          applyExpenseResponse(await window.api.updateJobExpense(current.id, id, { [field]: value }));
          triggerFinanceUpdate();
        } catch (err) {
          console.error(err);
          showToast(err.message || 'Failed to update cost', 'error');
          renderExpenses();
          throw err;
        }
      })()).catch(() => {});
    });

    expensesBody.addEventListener('click', async (e) => {
      const btn = e.target.closest('.exp-remove');
      if (!btn) return;
      const expense = expenseState.expenses.find(x => Number(x.id) === Number(btn.dataset.id));
      if (!confirm(`Remove the cost "${(expense && expense.description) || 'this cost'}"? The job's cost goes down by $${formatMoney(expense ? expense.amount : 0)}.`)) return;
      try {
        applyExpenseResponse(await track(window.api.deleteJobExpense(current.id, btn.dataset.id)));
        triggerFinanceUpdate();
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Failed to remove cost', 'error');
      }
    });

    expensesBody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 'exp-description' || e.target.id === 'exp-amount')) {
        e.preventDefault();
        addDraftExpense();
      }
    });
  }

  // ---------- save / close ----------
  async function flush() {
    await Promise.allSettled([...pending]);
    const draft = admin ? lineDraft() : null;
    if (draft) {
      await addLineItems([draft]);
      $('#li-description').value = '';
      $('#li-unit-price').value = '';
    }
    const costDraft = admin ? expenseDraft() : null;
    if (costDraft) {
      await addExpense(costDraft);
      $('#exp-description').value = '';
      $('#exp-amount').value = '';
    }
    const payload = collectFields();
    if (!sameFields(payload, savedFields)) {
      const res = await window.api.updateJob(current.id, payload);
      current = { ...current, ...res.job };
      savedFields = collectFields();
    }
    const amount = admin ? pendingPayment() : 0;
    if (amount > 0) await recordPayment(amount);
    for (const ta of openNoteEdits()) {
      await window.api.updateJobNote(current.id, ta.dataset.noteId, ta.value.trim());
      ta.dataset.original = ta.value.trim();
    }
    if (noteInput && noteInput.value.trim()) {
      await window.api.addJobNote(current.id, noteInput.value.trim());
      noteInput.value = '';
      if (notesApi) notesApi.reload();
    }
    renderMoney();
  }

  async function saveAndClose() {
    if (closing) return;
    closing = true;
    setJobStatusChip('saving');
    try {
      await flush();
    } catch (err) {
      console.error(err);
      closing = false;
      setJobStatusChip('error');
      showToast(`Couldn't save this job: ${err.message}. It's still open, so nothing is lost.`, 'error');
      return;
    }
    panel.remove();
    triggerFinanceUpdate();
    if (onSave) await onSave();
  }
  panel._requestClose = saveAndClose;
  $('#closeJobPanel').onclick = saveAndClose;
  ['dragover', 'drop'].forEach((type) => {
    panel.addEventListener(type, (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
        e.preventDefault();
        if (type === 'dragover' && !e.target.closest('.job-files-field')) e.dataTransfer.dropEffect = 'none';
      }
    });
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) saveAndClose();
  });

  panel.addEventListener('input', (e) => {
    if (e.target.closest('#job-line-items-list, #job-tag-input')) return;
    userEdited = true;
    if (e.target === totalEl || e.target === costEl) renderMoney();
    refreshDirtyChip();
  });
  panel.addEventListener('change', () => refreshDirtyChip());

  const saveBtn = $('#job-save-btn');
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    setJobStatusChip('saving');
    try {
      await flush();
      setJobStatusChip('saved');
      showToast('Job saved', 'success');
      if (onSave) await onSave();
    } catch (err) {
      console.error(err);
      setJobStatusChip('error');
      showToast(err.message || 'Failed to save job', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Job';
      refreshDirtyChip();
    }
  };

  // Estimate / Invoice — available to any user with access to this job;
  // these PDFs never include job_cost/profit/margin. Pending edits are saved
  // first so the document matches what's on screen.
  function wireDocButton(btn, mode) {
    if (!btn) return;
    const label = btn.textContent;
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        btn.textContent = 'Downloading...';
        await flush();
        if (mode === 'estimate') await window.api.sendJobEstimate(current.id);
        else await window.api.sendJobInvoice(current.id);
        showToast(mode === 'estimate' ? 'Estimate downloaded' : 'Invoice downloaded', 'success');
      } catch (err) {
        showToast(err.message || `Failed to generate ${mode}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
        refreshDirtyChip();
      }
    };
  }
  wireDocButton($('#job-estimate-btn'), 'estimate');
  wireDocButton($('#job-invoice-btn'), 'invoice');

  const duplicateBtn = $('#job-duplicate-btn');
  duplicateBtn.onclick = async () => {
    duplicateBtn.disabled = true;
    try {
      await flush();
      if (!lineItemsLoaded) await loadLineItems();
      const payload = {
        client_id: clientId,
        title: nextRecurringTitle(current.title),
        status: 'Prospect',
        scope_of_work: current.scope_of_work || ''
      };
      if (admin) {
        if (lineItems.length) payload.line_items = copyLineItems(lineItems);
        else payload.total_due = Number(current.total_due || 0);
        if (hasItemizedCosts()) payload.expenses = copyExpenses(expenseState.expenses);
        else payload.job_cost = Number(current.job_cost || 0);
      } else if (lineItems.length && !payload.scope_of_work.trim()) {
        payload.scope_of_work = scopeFromLineItems(lineItems);
      }
      const res = await window.api.createJob(payload);
      showToast(`Created “${res.job.title}”`, 'success');
      panel.remove();
      triggerFinanceUpdate();
      if (onSave) await onSave();
      openJobPanel(res.job, clientId, onSave);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to duplicate job', 'error');
      duplicateBtn.disabled = false;
    }
  };

  $('#job-delete-btn').onclick = async () => {
    const paid = Number(current.amount_paid || 0);
    const message = 'Permanently delete this job, including its services, files and notes?' +
      (paid > 0 ? `\n\nThe $${formatMoney(paid)} received on it stays in the Finance payment history.` : '');
    if (!confirm(message)) return;
    try {
      await window.api.deleteJob(current.id);
      closing = true;
      panel.remove();
      triggerFinanceUpdate();
      if (onSave) await onSave();
      showToast('Job deleted', 'success');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to delete job', 'error');
    }
  };

  // ---------- load ----------
  renderSchedule();
  statusEl.addEventListener('change', renderSchedule);
  [startEl, durationEl].forEach((el) => { if (el) el.addEventListener('input', renderSchedule); });
  renderMoney();
  setupJobNotesSection(panel, current.id).then(api => { notesApi = api; });
  setupJobFilesSection(panel, current.id, 'document');
  setupJobFilesSection(panel, current.id, 'photo');
  renderClientFilesInJob();
  loadLineItems();
  loadPayments();
  loadExpenses();
}

// ======================================================
// JOB NOTES — same pattern as the client notes panel, scoped to one job.
// ======================================================
async function setupJobNotesSection(overlay, jobId) {
  const notesList = overlay.querySelector('#job-notes-list');
  const newNoteInput = overlay.querySelector('#job-new-note-input');
  const addNoteBtn = overlay.querySelector('#job-add-note-btn');
  if (!notesList || !newNoteInput || !addNoteBtn) return;

  async function loadNotes() {
    notesList.innerHTML = '<div class="field-hint">Loading notes...</div>';
    try {
      const data = await window.api.listJobNotes(jobId);
      const notes = data.notes || [];
      if (!notes.length) {
        notesList.innerHTML = `<div class="field-hint">No notes yet.</div>`;
        return;
      }
      notesList.innerHTML = '';
      notes.forEach((note) => {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'job-note-row';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'job-note-content';
        contentDiv.innerText = note.content || '';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'job-note-action-btn btn-secondary btn-sm';
        editBtn.innerText = 'Edit';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'job-note-action-btn job-note-delete-btn btn-danger btn-sm';
        deleteBtn.innerText = 'Delete';

        editBtn.onclick = () => {
          const textarea = document.createElement('textarea');
          textarea.className = 'job-note-edit-textarea';
          textarea.value = note.content || '';
          textarea.rows = 4;
          textarea.setAttribute('aria-label', 'Edit note');
          // Lets the job workspace save an edit left open when it closes.
          textarea.dataset.noteId = note.id;
          textarea.dataset.original = note.content || '';

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'job-note-action-btn btn-primary btn-sm';
          saveBtn.innerText = 'Save';

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'job-note-action-btn btn-secondary btn-sm';
          cancelBtn.innerText = 'Cancel';

          noteDiv.replaceChild(textarea, contentDiv);
          noteDiv.insertBefore(saveBtn, editBtn);
          noteDiv.insertBefore(cancelBtn, editBtn);
          editBtn.style.display = 'none';
          deleteBtn.style.display = 'none';

          cancelBtn.onclick = () => loadNotes();
          saveBtn.onclick = async () => {
            const trimmed = textarea.value.trim();
            if (!trimmed) { showToast('Note cannot be empty', 'error'); return; }
            try {
              await window.api.updateJobNote(jobId, note.id, trimmed);
              loadNotes();
            } catch (err) {
              console.error(err);
              showToast('Failed to update note', 'error');
            }
          };
        };

        deleteBtn.onclick = async () => {
          if (!confirm('Delete this note?')) return;
          try {
            await window.api.deleteJobNote(jobId, note.id);
            loadNotes();
          } catch (err) {
            console.error(err);
            showToast('Failed to delete note', 'error');
          }
        };

        noteDiv.appendChild(contentDiv);
        noteDiv.appendChild(editBtn);
        noteDiv.appendChild(deleteBtn);
        notesList.appendChild(noteDiv);
      });
    } catch (err) {
      console.error(err);
      notesList.innerHTML = `<div class="field-hint">Failed to load notes.</div>`;
    }
  }

  addNoteBtn.onclick = async () => {
    const content = newNoteInput.value.trim();
    if (!content) { showToast('Cannot add empty note', 'error'); return; }
    try {
      addNoteBtn.disabled = true;
      await window.api.addJobNote(jobId, content);
      newNoteInput.value = '';
      newNoteInput.dispatchEvent(new Event('input', { bubbles: true }));
      loadNotes();
    } catch (err) {
      console.error(err);
      showToast('Failed to add note', 'error');
    } finally {
      addNoteBtn.disabled = false;
    }
  };

  loadNotes();
  return { reload: loadNotes };
}

// ======================================================
// JOB FILES — Documents and Photos are the same upload/list/delete flow,
// kept visually and functionally separate purely by `category` so the two
// never end up mixed in one generic file list.
// ======================================================
function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function setupJobFilesSection(overlay, jobId, category) {
  const isPhoto = category === 'photo';
  const listEl = overlay.querySelector(isPhoto ? '#job-photos-list' : '#job-documents-list');
  const uploadBtn = overlay.querySelector(isPhoto ? '#job-photos-upload-btn' : '#job-documents-upload-btn');
  const fileInput = overlay.querySelector(isPhoto ? '#job-photos-input' : '#job-documents-input');
  const progressEl = overlay.querySelector(isPhoto ? '#job-photos-progress' : '#job-documents-progress');
  if (!listEl || !uploadBtn || !fileInput) return;

  const progressBar = progressEl ? progressEl.querySelector('.job-file-progress-bar') : null;
  const progressLabel = progressEl ? progressEl.querySelector('.job-file-progress-label') : null;

  function setProgress(pct, label) {
    if (!progressEl) return;
    progressEl.hidden = false;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressLabel) progressLabel.textContent = label;
  }
  function hideProgress() {
    if (progressEl) progressEl.hidden = true;
  }

  async function loadFiles() {
    listEl.innerHTML = `<div class="field-hint">Loading ${isPhoto ? 'photos' : 'documents'}...</div>`;
    try {
      const data = await window.api.listJobFiles(jobId, category);
      const files = data.files || [];
      if (!files.length) {
        listEl.innerHTML = `<div class="field-hint">No ${isPhoto ? 'photos' : 'documents'} yet.</div>`;
        return;
      }
      listEl.innerHTML = '';
      files.forEach((file) => {
        const row = document.createElement(isPhoto ? 'a' : 'div');
        row.className = isPhoto ? 'job-photo-thumb' : 'job-file-row';
        const url = window.api.jobFileDownloadUrl(jobId, file.id);

        if (isPhoto) {
          row.href = url;
          row.target = '_blank';
          row.rel = 'noopener';
          row.innerHTML = `
            <img src="${url}" alt="${escapeHtml(file.file_name)}" loading="lazy">
            <button type="button" class="job-file-delete-btn" title="Delete photo">&times;</button>
          `;
        } else {
          row.innerHTML = `
            <a href="${url}" target="_blank" rel="noopener" class="job-file-name"><i data-lucide="file-text"></i> ${escapeHtml(file.file_name)}</a>
            <span class="job-file-meta">${formatFileSize(file.size_bytes)}</span>
            <button type="button" class="job-file-delete-btn" title="Delete document">&times;</button>
          `;
        }

        row.querySelector('.job-file-delete-btn').addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`Delete this ${isPhoto ? 'photo' : 'document'}?`)) return;
          try {
            await window.api.deleteJobFile(jobId, file.id);
            loadFiles();
          } catch (err) {
            console.error(err);
            showToast(`Failed to delete ${isPhoto ? 'photo' : 'document'}`, 'error');
          }
        });

        listEl.appendChild(row);
      });
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      console.error(err);
      listEl.innerHTML = `<div class="field-hint">Failed to load ${isPhoto ? 'photos' : 'documents'}.</div>`;
    }
  }

  // Same rule as the server (api/job-files.js) and the file picker.
  const DOC_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx'];
  function isAccepted(file) {
    const name = String(file.name || '').toLowerCase();
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    if (isPhoto) return String(file.type || '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)$/.test(name);
    return DOC_EXTENSIONS.includes(ext) || file.type === 'application/pdf';
  }

  let uploading = false;
  // Used by both the picker and drag-and-drop. Unsupported files are left
  // out (and named) instead of failing the whole batch; existing files are
  // never touched — uploads only ever add.
  async function uploadFiles(fileList) {
    const all = Array.from(fileList || []);
    if (!all.length) return;
    if (uploading) { showToast('Please wait for the current upload to finish', 'info'); return; }
    const files = all.filter(isAccepted);
    const skipped = all.filter(f => !isAccepted(f));
    if (skipped.length) {
      showToast(`${isPhoto ? 'Only images can be added to Photos' : 'Only PDF, Word or Excel files can be added to Documents'} — skipped ${skipped.map(f => f.name).join(', ')}`, 'error', 5000);
    }
    if (!files.length) return;
    uploading = true;
    uploadBtn.disabled = true;
    if (dropzone) dropzone.classList.add('is-uploading');
    setProgress(0, `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    try {
      await window.api.uploadJobFiles(jobId, category, files, (pct) => {
        setProgress(pct, `Uploading... ${pct}%`);
      });
      showToast(`${files.length} ${isPhoto ? 'photo' : 'document'}${files.length > 1 ? 's' : ''} uploaded`, 'success');
      loadFiles();
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to upload ${isPhoto ? 'photos' : 'documents'}`, 'error');
    } finally {
      uploading = false;
      uploadBtn.disabled = false;
      if (dropzone) dropzone.classList.remove('is-uploading');
      fileInput.value = '';
      hideProgress();
    }
  }

  uploadBtn.onclick = () => fileInput.click();
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

  // Drag-and-drop: the whole Documents (or Photos) section is the target,
  // highlighted while files are dragged over it.
  const section = uploadBtn.closest('.job-section');
  const dropzone = overlay.querySelector(isPhoto ? '#job-photos-dropzone' : '#job-documents-dropzone');
  const hasFiles = (e) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
  if (section) {
    let depth = 0;
    const setActive = (on) => { section.classList.toggle('is-dragover', on); };
    section.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setActive(true);
    });
    section.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    section.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setActive(false);
    });
    section.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setActive(false);
      uploadFiles(e.dataTransfer.files);
    });
  }

  loadFiles();
}

// ======================================================
// PDF UPLOAD BUTTON
// ======================================================
function setupPDFUploadButton() {
  const uploadBtn = document.getElementById("pdf-upload-btn");
  const fileInput = document.getElementById("pdf-file-input");
  if (!uploadBtn || !fileInput) return;

  uploadBtn.addEventListener("click", async () => {
    if (typeof fileInput.showPicker === "function") {
      try {
        fileInput.showPicker();
        return;
      } catch (err) {
        // Some browsers only allow showPicker on visible inputs; fall back to click.
      }
    }

    fileInput.click();
  });

  fileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !activeId) return;

    const originalText = uploadBtn.textContent;
    uploadBtn.textContent = "Uploading...";
    uploadBtn.disabled = true;

    try {
      await window.api.uploadPDFsWithFallback(files, activeId);
      showToast("Upload complete", "success");
      loadPDFs(activeId);
    } catch (err) {
      console.error(err);
      showToast("Upload failed", "error");
    } finally {
      uploadBtn.textContent = originalText;
      uploadBtn.disabled = false;
      fileInput.value = "";
    }
  });
}

// ======================================================
// PDF DISPLAY — client-level files (the client account's drop box)
// ======================================================
async function loadPDFs(clientId) {
  const container = document.getElementById("pdf-list");
  if (!container) return;

  try {
    const data = await window.api.listPDFs(clientId);
    const files = data.files || [];
    if (Number(clientId) === Number(activeId)) activeClientFiles = files;
    if (!files.length) {
      container.innerHTML = `<div class="field-hint">No client files uploaded.</div>`;
      return;
    }
    renderClientFileRows(container, clientId, files, () => loadPDFs(clientId));
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="field-hint" style="color:var(--danger);">Failed to load files.</div>`;
  }
}

// ======================================================
// DRAG & DROP
// ======================================================
function setupDropZone() {
  const dz = document.getElementById("pdf-drop-zone");
  if (!dz) return;

  ["dragover", "dragleave", "drop"].forEach(evt =>
    dz.addEventListener(evt, e => {
      e.preventDefault();
      e.stopPropagation();
    })
  );

  dz.addEventListener("drop", async (e) => {
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || !activeId) return;

    const original = dz.textContent;
    dz.textContent = "Uploading...";
    try {
      await window.api.uploadPDFs(files, activeId);
      showToast("Upload complete", "success");
      loadPDFs(activeId);
    } catch (err) {
      console.error(err);
      showToast("Upload failed", "error");
    } finally {
      dz.textContent = original;
    }
  });
}

// ======================================================
// PANEL BUTTON HANDLER (client overview). Money, estimates/invoices and the
// undo stack for client-level amounts live in the client account workspace
// (openClientAccountPanel) now.
// ======================================================
if (projectPanel) {
  projectPanel.addEventListener("click", async (e) => {
    const target = e.target.closest("button") || e.target;

    if (target.id === "printBtn") printClientWorkspace();

    if (target.id === "reviewBtn") {
      const googleLink = activeClient?.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeClient.address)}`
        : "https://www.google.com/maps/search/?api=1&query=CRM+Template";
      window.open(googleLink, "_blank");
    }

    if (target.id === "saveBtn") {
      const ok = await savePanelChanges({ silent: false, force: true });
      if (ok) openClient(activeId);
    }

    if (target.id === "delBtn") {
      if (confirm("Permanently delete this client, including all of its jobs?")) {
        try {
          await window.api.deleteClient(activeId);
          triggerFinanceUpdate();
          await refreshList();
          closePanel();
          showToast("Client deleted", "success");
        } catch (err) {
          console.error(err);
          showToast("Failed to delete client", "error");
        }
      }
    }

    if (target.id === "closeBtn") {
      await requestClientPanelClose();
    }
  });
}

// Saves the client overview, then closes it. If the save fails the panel
// stays open so the edits aren't lost.
async function requestClientPanelClose() {
  const ok = await savePanelChanges({ silent: true, force: true });
  if (!ok) {
    showToast("Couldn't save the client. It's still open, so nothing is lost.", "error");
    return;
  }
  closePanel();
}

if (emailSettingsBtn) {
  emailSettingsBtn.addEventListener('click', () => {
    openEmailSettingsModal();
  });
}

if (companyProfileBtn) {
  companyProfileBtn.addEventListener('click', () => {
    openCompanyProfileModal();
  });
}

var userSettingsBtn = document.getElementById('userSettingsBtn');
if (userSettingsBtn) {
  userSettingsBtn.addEventListener('click', () => {
    window.location.href = '/settings';
  });
}

if (closeEmailSettingsBtn) {
  closeEmailSettingsBtn.addEventListener('click', closeEmailSettingsModal);
}

if (closeCompanyProfileBtn) {
  closeCompanyProfileBtn.addEventListener('click', closeCompanyProfileModal);
}

if (cancelEmailSettingsBtn) {
  cancelEmailSettingsBtn.addEventListener('click', closeEmailSettingsModal);
}

if (cancelCompanyProfileBtn) {
  cancelCompanyProfileBtn.addEventListener('click', closeCompanyProfileModal);
}

if (emailSettingsModal) {
  emailSettingsModal.addEventListener('click', (e) => {
    if (e.target === emailSettingsModal) {
      closeEmailSettingsModal();
    }
  });
}

if (companyProfileModal) {
  companyProfileModal.addEventListener('click', (e) => {
    if (e.target === companyProfileModal) {
      closeCompanyProfileModal();
    }
  });
}

if (emailProviderEl) {
  emailProviderEl.addEventListener('change', () => {
    applyEmailProviderDefaults(emailProviderEl.value, { force: true });
  });
}

if (emailSettingsForm) {
  emailSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = collectEmailSettingsPayload();
    if (!payload.smtpUser) {
      showToast('SMTP username is required', 'error');
      return;
    }

    if (!payload.smtpPassword && !currentEmailSettings?.hasPassword) {
      showToast('Enter the SMTP password to save this sender', 'error');
      return;
    }

    if (!payload.smtpPort || Number.isNaN(payload.smtpPort) || payload.smtpPort < 1) {
      showToast('Enter a valid SMTP port', 'error');
      return;
    }

    try {
      if (saveEmailSettingsBtn) {
        saveEmailSettingsBtn.disabled = true;
        saveEmailSettingsBtn.textContent = 'Saving...';
      }
      const result = await window.api.saveEmailSettings(payload);
      window.api._emailSettings = result;
      currentEmailSettings = result?.settings || null;
      showToast('Email setup saved', 'success');
      closeEmailSettingsModal();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to save email setup', 'error');
    } finally {
      if (saveEmailSettingsBtn) {
        saveEmailSettingsBtn.disabled = false;
        saveEmailSettingsBtn.textContent = 'Save Email Setup';
      }
    }
  });
}

if (companyProfileForm) {
  companyProfileForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = collectCompanyProfilePayload();
    if (!payload.businessName.trim()) {
      showToast('Company name is required', 'error');
      return;
    }

    try {
      if (saveCompanyProfileBtn) {
        saveCompanyProfileBtn.disabled = true;
        saveCompanyProfileBtn.textContent = 'Saving...';
      }
      const result = await window.api.saveCompanyProfile(payload);
      window.api._companyProfile = result;
      currentCompanyProfile = result?.settings || null;
      showToast('Company profile saved', 'success');
      closeCompanyProfileModal();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to save company profile', 'error');
    } finally {
      if (saveCompanyProfileBtn) {
        saveCompanyProfileBtn.disabled = false;
        saveCompanyProfileBtn.textContent = 'Save Company Profile';
      }
    }
  });
}

// ======================================================
// HELPERS
// ======================================================

function showToast(message, type = "info", timeout = 2200) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, timeout);
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseMoney(value) {
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}


// Money fields type naturally (no reformatting while typing) and show
// "1,250.50" once the field is left — see public/js/money-input.js.
// Pass { decimals: 'auto' } for quantities.
function applyMoneyInputBehavior(input, options) {
  if (!input || !window.crmMoney) return;
  window.crmMoney.attach(input, options);
}



async function savePendingNotes({ silent = false } = {}) {
  if (!activeId) return;

  const noteEdits = document.querySelectorAll("textarea[data-note-id]");
  for (const ta of noteEdits) {
    const noteId = ta.dataset.noteId;
    const clientId = ta.dataset.clientId;
    const original = ta.dataset.original || "";
    const trimmed = ta.value.trim();
    if (!noteId || !clientId || !trimmed || trimmed === original) continue;
    try {
      await window.api.updateNote(clientId, noteId, trimmed);
      ta.dataset.original = trimmed;
    } catch (err) {
      console.error(err);
      if (!silent) showToast("Failed to update note", "error");
    }
  }

  const newNoteInput = document.getElementById("new-note-input");
  if (newNoteInput) {
    const content = newNoteInput.value.trim();
    if (content) {
      try {
        await window.api.addNote(activeId, content);
        newNoteInput.value = "";
      } catch (err) {
        console.error(err);
        if (!silent) showToast("Failed to add note", "error");
      }
    }
  }
}

function getStoredClientName() {
  return (activeClient?.name || projectPanel.dataset.clientName || "").trim();
}

// Only the fields shown on the client overview. Money, cost and scope are
// edited inside jobs / the client account, and the server leaves any field
// that isn't sent untouched.
function collectPanelData() {
  const value = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
  };
  const typedName = (value("p-name") || "").trim();
  return {
    id: activeId,
    name: typedName || getStoredClientName(),
    address: value("p-address"),
    status: value("p-status"),
    phone: value("p-phone"),
    email: value("p-email"),
    technician: value("p-technician")
  };
}

// Returns true when everything saved.
async function savePanelChanges({ silent = false, force = false } = {}) {
  if (!activeId) return true;
  if (isSaving) {
    queuedSave = true;
    return true;
  }

  isSaving = true;
  setSaveStatus("saving");
  try {
    await savePendingNotes({ silent: true });

    const data = collectPanelData();
    if (!force && !data) return true;

    await window.api.updateProject(data);
    if (activeClient && Number(activeClient.id) === Number(data.id)) {
      ["name", "address", "status", "phone", "email", "technician"].forEach(k => {
        if (data[k] !== undefined) activeClient[k] = data[k];
      });
      projectPanel.dataset.clientName = activeClient.name || "";
      const headerName = document.getElementById("clientHeaderName");
      if (headerName) headerName.textContent = activeClient.name || "";
    }
    await refreshList();
    await setupNotesSection(activeId);
    setSaveStatus("saved");
    if (!silent) {
      showToast("Saved", "success");
    }
    return true;
  } catch (err) {
    console.error(err);
    setSaveStatus("error");
    if (!silent) showToast("Save failed", "error");
    return false;
  } finally {
    isSaving = false;
    if (queuedSave) {
      queuedSave = false;
      savePanelChanges({ silent: true, force: true });
    }
  }
}

function getPanelFName() {
  const [firstName] = getStoredClientName().split(/\s+/);
  return firstName || "";
}

function getPanelLName() {
  const parts = getStoredClientName().split(/\s+/);
  return parts.slice(1).join(" ") || "";
}

function closePanel() {

  if (overlay) overlay.style.display = "none";

  const panel = projectPanel.querySelector(".animate-panel");
  if (panel) {
    panel.style.opacity = 0;
    panel.style.transform = "translateY(-20px)";
  }

  setTimeout(() => {
    projectPanel.innerHTML = '';
    projectPanel.style.display = "none";
    delete projectPanel.dataset.clientName;
    activeId = null;
    activeClient = null;
  }, 250);

  // RESTORE MOBILE VIEW
  if (shouldUseMobileSidebarSwitch()) {
    const sidebar = document.querySelector(".sidebar");
    const mainContent = document.querySelector(".main-content");

    if (sidebar) sidebar.classList.remove("mobile-hidden");
    if (mainContent) mainContent.classList.remove("mobile-full");
  }
}

// ======================================================
// SIDEBAR CLICK
// ======================================================
if (clientList) {
  clientList.addEventListener("scroll", () => {
    if (!sidebarListContainer) return;
    const nearBottom =
      clientList.scrollTop + clientList.clientHeight >= clientList.scrollHeight - 120;
    if (nearBottom) renderSidebarChunk();
  });

  clientList.addEventListener("click", (e) => {
    const countRow = e.target.closest(".status-count-row");
    if (countRow && countRow.dataset.filterStatus) {
      searchByTagClick(countRow.dataset.filterStatus);
      return;
    }
    const statusBadge = e.target.closest(".client-status");
    if (statusBadge && statusBadge.dataset.filterStatus) {
      e.stopPropagation();
      searchByTagClick(statusBadge.textContent.trim());
      return;
    }
    const item = e.target.closest(".client-card");
    if (item) openClient(parseInt(item.dataset.id));
  });
}

// ======================================================
// INITIAL LOAD
// ======================================================
document.addEventListener("financeUpdated", () => {
  scheduleMainDashboardRefresh();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scheduleMainDashboardRefresh();
  }
});

window.addEventListener("focus", () => {
  scheduleMainDashboardRefresh();
});

document.addEventListener("keydown", async (e) => {
  if (e.key === "Escape" && companyProfileModal?.classList.contains('open')) {
    closeCompanyProfileModal();
    return;
  }

  if (e.key === "Escape" && emailSettingsModal?.classList.contains('open')) {
    closeEmailSettingsModal();
    return;
  }

  if (e.key !== "Escape") return;

  // Close the top-most layer only: pickers first, then a job / client
  // account / new-job dialog (each saves on close), then the client panel.
  const pickers = ["manageServicesOverlay", "servicePresetPickerOverlay", "servicePickerOverlay"]
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (pickers.length) {
    const top = pickers[0];
    if (typeof top._requestClose === "function") top._requestClose();
    else top.remove();
    return;
  }
  const dialogs = document.querySelectorAll(".job-modal-overlay");
  if (dialogs.length) {
    const top = dialogs[dialogs.length - 1];
    if (typeof top._requestClose === "function") await top._requestClose();
    else top.remove();
    return;
  }
  const pdfViewerModal = document.getElementById("pdfModal");
  if (pdfViewerModal && pdfViewerModal.style.display === "flex") return;

  if (projectPanel && projectPanel.style.display === "block") {
    await requestClientPanelClose();
  }
});


// ======================================================
// DASHBOARD INITIALIZATION
// ======================================================
var _dashboardData = null;
var _dashboardLoading = false;

async function loadDashboardStats() {
  if (_dashboardLoading) return;
  _dashboardLoading = true;
  try {
    var result = await window.api.getDashboardStats();
    if (!result || !result.success || !result.data) {
      hideDashboardSection();
      return;
    }
    _dashboardData = result.data;
    _platformFeatures = result.data.platformFeatures || null;
    renderDashboardStats(result.data);
    renderWorkflowPanel(result.data);
    applyBranding(result.data.branding);
    window._retentionRiskIds = (result.data.retentionAlerts || []).map(function (a) { return a.id; });
  } catch (e) {
    hideDashboardSection();
  } finally {
    _dashboardLoading = false;
  }
}

function hideDashboardSection() {
  var el = document.getElementById('dashboardOverview');
  if (el) el.style.display = 'none';
}

function renderDashboardStats(data) {
  setStat('statTotalClients', data.totalClients);
  setStat('statActiveJobs', data.activeJobs);
  setStat('statOutstanding', data.outstandingInvoices);
  setStat('statRevenue', '$' + formatMoney(data.thisMonthRevenue));
}

function setStat(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val != null ? String(val) : '—';
}

function renderWorkflowPanel(data) {
  var titleEl = document.getElementById('workflowPanelTitle');
  var bodyEl = document.getElementById('workflowPanelBody');
  if (!bodyEl || !titleEl) return;

  var wf = data.workflow || 'both';
  var title = 'Pipeline Overview';
  if (wf === 'single') title = 'Job Pipeline';
  else if (wf === 'returning') title = 'Recurring Clients';
  titleEl.textContent = title;

  var html = '';
  if (wf === 'single' || wf === 'both') {
    var statuses = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];
    html += '<div class="kanban-board">';
    statuses.forEach(function (s) {
      // Estimate counts from total — we don't have per-status counts on the server
      html += '<div class="kanban-col"><div class="kanban-header">' + s + '</div><div class="kanban-count">—</div></div>';
    });
    html += '</div>';
  }
  if (wf === 'returning' || wf === 'both') {
    var alerts = data.retentionAlerts || [];
    html += '<div class="recurring-manager">';
    if (alerts.length === 0) {
      html += '<div class="empty">No retention risks. All recurring clients are in good standing.</div>';
    } else {
      alerts.slice(0, 5).forEach(function (a) {
        html += '<div class="recurring-client-row"><span class="client-name">' + escapeHtml(a.name) + '</span><span class="client-status" style="background:var(--danger-soft); color:var(--danger); border:1px solid var(--danger-soft);">At Risk</span></div>';
      });
    }
    html += '</div>';
  }
  if (!html) {
    html = '<div class="empty-panel-msg">No workflow data available.</div>';
  }

  // Revenue split
  var rev = data.revenueSplit || { oneOffRevenue: 0, recurringRevenue: 0 };
  var totalRev = rev.oneOffRevenue + rev.recurringRevenue;
  var oneOffPct = totalRev > 0 ? Math.round((rev.oneOffRevenue / totalRev) * 100) : 0;
  var recurringPct = totalRev > 0 ? Math.round((rev.recurringRevenue / totalRev) * 100) : 0;

  html += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-soft);">';
  html += '<div style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">Revenue Split</div>';
  html += '<div class="revenue-split-bar"><div class="one-off-bar" style="width:' + oneOffPct + '%"></div><div class="recurring-bar" style="width:' + recurringPct + '%"></div></div>';
  html += '<div class="revenue-split-labels"><span>One-off $' + formatMoney(rev.oneOffRevenue) + '</span><span>Recurring $' + formatMoney(rev.recurringRevenue) + '</span></div>';
  html += '</div>';

  bodyEl.innerHTML = html;
}

function renderFeaturePanel(data) {
  var bodyEl = document.getElementById('featurePanelBody');
  if (!bodyEl) return;

  var features = data.activeFeatures || [];
  if (features.length === 0) {
    bodyEl.innerHTML = '<div class="empty-panel-msg">No features active. Complete onboarding to enable features.</div>';
    return;
  }

  var html = '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
  features.forEach(function (f) {
    var label = (f.component_type || '').replace(/-/g, ' ');
    html += '<span class="feature-chip ' + (f.is_active ? 'active' : 'inactive') + '">' + escapeHtml(label) + '</span>';
  });
  html += '</div>';
  html += '<div style="margin-top:10px;font-size:0.78rem;color:var(--text-muted);">' + features.length + ' feature' + (features.length !== 1 ? 's' : '') + ' configured.</div>';
  bodyEl.innerHTML = html;
}

function renderPlatformFeatures(data) {
  var bodyEl = document.getElementById('platformFeaturePanelBody');
  if (!bodyEl) return;

  var pf = data.platformFeatures || {};
  var features = [
    { key: 'advancedFiltering', label: 'Advanced Filtering' },
    { key: 'clientPortal', label: 'Client Portal' },
    { key: 'emailTemplates', label: 'Email Templates' },
    { key: 'multiCurrency', label: 'Multi-Currency' },
    { key: 'recurringInvoices', label: 'Recurring Invoices' },
    { key: 'exportReporting', label: 'Export & Reporting' },
    { key: 'roleBasedAccess', label: 'Role-Based Access' },
    { key: 'activityLog', label: 'Activity Log' }
  ];

  var html = '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
  features.forEach(function (f) {
    var isActive = pf[f.key] === true || (f.key === 'currency' ? false : pf[f.key] === true);
    // currency is a string, not boolean
    if (f.key === 'multiCurrency') isActive = pf.multiCurrency === true;
    html += '<span class="feature-chip ' + (isActive ? 'active' : 'inactive') + '">' + escapeHtml(f.label) + '</span>';
  });
  html += '</div>';

  if (pf.currency && pf.currency !== 'USD') {
    html += '<div style="margin-top:8px;font-size:0.78rem;color:var(--text-muted);">Base currency: <strong>' + escapeHtml(pf.currency) + '</strong></div>';
  }

  bodyEl.innerHTML = html;
}

function applyBranding(branding) {
  if (!branding || !branding.companyName) return;

  // Set page title
  document.title = branding.companyName + ' — Dashboard';

  // Update kicker
  var kicker = document.querySelector('.page-kicker');
  if (kicker) kicker.textContent = branding.companyName;

  // Show logo if present in nav brand
  var logoContainer = document.getElementById('brandLogoContainer');
  var logoImg = document.getElementById('brandLogoImg');
  var nameSpan = document.getElementById('brandCompanyName');
  var brandFallback = document.getElementById('brandFallback');
  if (logoContainer && logoImg && nameSpan) {
    if (branding.logoUrl) {
      logoImg.src = branding.logoUrl;
      logoImg.style.display = 'inline';
      logoContainer.style.display = 'flex';
    }
    nameSpan.textContent = branding.companyName;
  }
  if (brandFallback) brandFallback.style.display = 'none';

  // Apply brand colors as CSS variables — only when a company has actually
  // chosen its own. The template default (#2563eb) is already the light
  // theme's primary; forcing it inline would also override dark mode's
  // brighter blue and leave links/labels too dark to read on navy.
  const TEMPLATE_DEFAULT_BRAND = '#2563eb';
  const isCustom = (color) => color && String(color).toLowerCase() !== TEMPLATE_DEFAULT_BRAND;
  if (isCustom(branding.primaryColor)) {
    document.documentElement.style.setProperty('--primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
  }
  if (isCustom(branding.secondaryColor)) {
    document.documentElement.style.setProperty('--accent', branding.secondaryColor);
    document.documentElement.style.setProperty('--brand-secondary', branding.secondaryColor);
  }

}

// ======================================================
// CONDITIONAL ADMIN NAV
// ======================================================
(function initAdminNav() {
  var adminLink = document.getElementById('adminNavLink');
  var userSettingsLink = document.getElementById('userSettingsNavLink');
  var roleBadge = document.getElementById('roleBadge');
  var financeLink = document.getElementById('navFinanceLink');
  if (window.__USER__) {
    if (window.__USER__.role === 'admin') {
      // Both links go to the same /settings page — showing both was just
      // a duplicate "Settings" entry, so admins get the one link, labeled
      // for what they can actually do there.
      if (adminLink) adminLink.style.display = '';
      if (userSettingsLink) userSettingsLink.style.display = 'none';
      if (financeLink) financeLink.style.display = '';
      if (roleBadge) { roleBadge.textContent = 'Admin'; roleBadge.className = 'role-badge admin'; roleBadge.style.display = ''; }
    } else {
      if (adminLink) adminLink.style.display = 'none';
      if (userSettingsLink) userSettingsLink.style.display = '';
      // Financial Overview is admin-only (Section 8) — the backend also
      // redirects /finance for regular users, this just avoids showing
      // a link that leads nowhere useful for them.
      if (financeLink) financeLink.style.display = 'none';
      if (roleBadge) { roleBadge.textContent = 'User'; roleBadge.className = 'role-badge user'; roleBadge.style.display = ''; }
    }
  }
})();

// ======================================================
// THEME TOGGLE (Light/Dark mode) — theme.js (loaded in <head>) already
// applied the saved theme before this ran; this just wires the button.
// ======================================================
(function initThemeToggle() {
  var btn = document.getElementById('themeToggleBtn');
  if (!btn || !window.crmTheme) return;
  function render() {
    btn.innerHTML = '<i data-lucide="' + (window.crmTheme.getTheme() === 'dark' ? 'sun' : 'moon') + '"></i>';
    if (window.lucide) window.lucide.createIcons();
  }
  render();
  btn.addEventListener('click', function () {
    window.crmTheme.toggleTheme();
    render();
  });
  document.addEventListener('crm-theme-change', render);
})();

function isAdminUser() {
  return Boolean(window.__USER__ && window.__USER__.role === 'admin');
}

// ======================================================
// INITIALIZATION
// ======================================================
// Ensure latest edits are sent before leaving the page

refreshList();
loadDashboardStats();

// Email Setup / Company Profile now link in from the Settings page (they
// used to be buttons directly on this dashboard) — open the matching
// modal here and drop the query param so a refresh doesn't reopen it.
(function openModalFromQueryParam() {
  var params = new URLSearchParams(window.location.search);
  var open = params.get('open');
  if (open === 'email-settings') {
    openEmailSettingsModal();
  } else if (open === 'company-profile') {
    openCompanyProfileModal();
  } else {
    return;
  }
  params.delete('open');
  var query = params.toString();
  window.history.replaceState({}, document.title, window.location.pathname + (query ? '?' + query : ''));
})();

// Opens a job's workspace (its client first) — used by the Calendar, whose
// events link to /main?job=<id>.
async function openJobById(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error(res.status === 404 ? 'That job no longer exists' : 'That job could not be opened');
    const { job } = await res.json();
    await openClient(job.client_id);
    const loaded = activeClientJobs.find(j => Number(j.id) === Number(job.id)) || job;
    openJobPanel(loaded, job.client_id, refreshOpenClientJobs);
  } catch (err) {
    console.error(err);
    showToast(err.message || 'That job could not be opened', 'error');
  }
}

(function openJobFromQueryParam() {
  var params = new URLSearchParams(window.location.search);
  var jobId = Number(params.get('job'));
  if (!Number.isInteger(jobId) || jobId <= 0) return;
  openJobById(jobId);
  params.delete('job');
  var query = params.toString();
  window.history.replaceState({}, document.title, window.location.pathname + (query ? '?' + query : ''));
})();

// Set page title from company profile (fallback if dashboard API fails)
(async () => {
  try {
    const response = await window.api.getCompanyProfile();
    const name = response?.settings?.businessName;
    if (name && name !== 'Your Company Name') {
      document.title = `${name} — Clients`;
      const kicker = document.querySelector('.page-kicker');
      if (kicker) kicker.textContent = name;
    }
  } catch (e) { /* silently skip */ }
})();
