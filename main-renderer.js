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
    input.style.cssText = 'width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border-strong,#cbd5e1);background:var(--surface,#ffffff);color:var(--text-main,#0f172a);font-size:0.9rem;box-sizing:border-box;outline:none;';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px;';

    var cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:1px solid var(--border-strong,#cbd5e1);background:var(--surface,#ffffff);color:var(--text-main,#0f172a);cursor:pointer;font-size:0.85rem;font-weight:600;';

    var okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:8px 16px;border-radius:8px;border:none;background:var(--primary,#2563eb);color:#fff;cursor:pointer;font-size:0.85rem;font-weight:600;';

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
// STATUS_ORDER_JOB / job tag handling further down in this file.
// ======================================================
const STATUS_ORDER = [
  "Lead",
  "Photo report",
  "Prospect",
  "Approved",
  "Invoiced",
  "Closed"
];

const STATUS_COLORS = {
  "Lead": "#64748b",
  "Photo report": "#b45309",
  "Prospect": "#7c3aed",
  "Approved": "#0e7490",
  "Invoiced": "#2563eb",
  "Closed": "#15803d"
};

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

  async searchClients(term = '', options = {}) {
    const { signal } = options;
    if (_filterActive) {
      var params = 'q=' + encodeURIComponent(term);
      if (_filterState.type) params += '&type=' + encodeURIComponent(_filterState.type);
      if (_filterState.status) params += '&status=' + encodeURIComponent(_filterState.status);
      if (_filterState.dateFrom) params += '&dateFrom=' + encodeURIComponent(_filterState.dateFrom);
      if (_filterState.dateTo) params += '&dateTo=' + encodeURIComponent(_filterState.dateTo);
      if (_filterState.revenueMin) params += '&revenueMin=' + encodeURIComponent(_filterState.revenueMin);
      if (_filterState.revenueMax) params += '&revenueMax=' + encodeURIComponent(_filterState.revenueMax);
      const res = await fetch('/api/search/filtered?' + params, { signal });
      if (!res.ok) throw new Error("Filtered search failed");
      return res.json();
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal });
    if (!res.ok) throw new Error("Search failed");
    return res.json();
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
    if (!res.ok) throw new Error('Failed to list jobs');
    return res.json();
  },

  async createJob(payload) {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to create job');
    return res.json();
  },

  async updateJob(jobId, payload) {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to update job');
    return res.json();
  },

  async addJobPayment(jobId, amount) {
    const res = await fetch(`/api/jobs/${jobId}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    });
    if (!res.ok) throw new Error('Failed to add job payment');
    return res.json();
  },

  async deleteJob(jobId) {
    const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete job');
    return res.json();
  },

  async updateJobTags(jobId, tags) {
    const res = await fetch(`/api/jobs/${jobId}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    });
    if (!res.ok) throw new Error('Failed to update job tags');
    return res.json();
  },

  async listJobLineItems(jobId) {
    const res = await fetch(`/api/jobs/${jobId}/line-items`);
    if (!res.ok) throw new Error('Failed to list line items');
    return res.json();
  },

  async addJobLineItem(jobId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/line-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to add line item');
    return res.json();
  },

  async updateJobLineItem(jobId, itemId, payload) {
    const res = await fetch(`/api/jobs/${jobId}/line-items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to update line item');
    return res.json();
  },

  async deleteJobLineItem(jobId, itemId) {
    const res = await fetch(`/api/jobs/${jobId}/line-items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete line item');
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
let _filterActive = false;
let _filterState = { type: '', status: '', dateFrom: '', dateTo: '', revenueMin: '', revenueMax: '' };

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

    if (
      refreshOpenClient &&
      activeId &&
      isClientPanelOpen() &&
      !hasUnsavedClientPanelChanges()
    ) {
      await openClient(activeId);
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
// ADVANCED FILTERING
// ======================================================
var filterToggleBtn = document.getElementById('filterToggleBtn');
var filterPanel = document.getElementById('filterPanel');
var filterType = document.getElementById('filterType');
var filterStatus = document.getElementById('filterStatus');
var filterDateFrom = document.getElementById('filterDateFrom');
var filterDateTo = document.getElementById('filterDateTo');
var filterRevenueMin = document.getElementById('filterRevenueMin');
var filterRevenueMax = document.getElementById('filterRevenueMax');
var applyFilterBtn = document.getElementById('applyFilterBtn');
var clearFilterBtn = document.getElementById('clearFilterBtn');

function initAdvancedFiltering() {
  if (!_platformFeatures || !_platformFeatures.advancedFiltering) {
    if (filterToggleBtn) filterToggleBtn.style.display = 'none';
    if (filterPanel) filterPanel.style.display = 'none';
    return;
  }
  if (filterToggleBtn) filterToggleBtn.style.display = '';
}

if (filterToggleBtn) {
  filterToggleBtn.addEventListener('click', function () {
    var isVisible = filterPanel && filterPanel.style.display !== 'none';
    if (filterPanel) filterPanel.style.display = isVisible ? 'none' : '';
  });
}

if (applyFilterBtn) {
  applyFilterBtn.addEventListener('click', function () {
    _filterState = {
      type: filterType ? filterType.value : '',
      status: filterStatus ? filterStatus.value : '',
      dateFrom: filterDateFrom ? filterDateFrom.value : '',
      dateTo: filterDateTo ? filterDateTo.value : '',
      revenueMin: filterRevenueMin ? filterRevenueMin.value : '',
      revenueMax: filterRevenueMax ? filterRevenueMax.value : ''
    };
    _filterActive = true;
    refreshList();
  });
}

if (clearFilterBtn) {
  clearFilterBtn.addEventListener('click', function () {
    if (filterType) filterType.value = '';
    if (filterStatus) filterStatus.value = '';
    if (filterDateFrom) filterDateFrom.value = '';
    if (filterDateTo) filterDateTo.value = '';
    if (filterRevenueMin) filterRevenueMin.value = '';
    if (filterRevenueMax) filterRevenueMax.value = '';
    _filterState = { type: '', status: '', dateFrom: '', dateTo: '', revenueMin: '', revenueMax: '' };
    _filterActive = false;
    refreshList();
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
    if (!clients || clients.length === 0) {
      clientList.innerHTML = `<li class="empty-state" style="text-align:center; padding:24px 16px;">
        <div style="margin-bottom:8px; color:var(--text-muted);"><i data-lucide="user" style="width:28px;height:28px;"></i></div>
        <div style="font-weight:700; color:var(--text-main); margin-bottom:4px;">No clients yet</div>
        <div style="font-size:0.85rem; color:var(--text-muted);">Add your first lead using the form above.</div>
      </li>`;
      if (window.lucide) window.lucide.createIcons();
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

  list.sort((a, b) =>
    STATUS_ORDER.indexOf(a.status || "Lead") -
    STATUS_ORDER.indexOf(b.status || "Lead")
  );

  const counts = {};
  STATUS_ORDER.forEach(s => counts[s] = 0);
  list.forEach(c => counts[c.status || "Lead"]++);

  const countsHTML = `
    <li class="status-counts" style="list-style:none; padding:0; margin:0 0 8px 0;">
      ${STATUS_ORDER.map(s =>
        `<div class="status-count-row" data-filter-status="${escapeHtml(s)}" title="Click to search this status" style="background:${STATUS_COLORS[s] || "#2563eb"}2e; color:${STATUS_COLORS[s] || "#2563eb"}; border:1px solid ${STATUS_COLORS[s] || "#2563eb"}70; cursor:pointer;">
          ${s}: ${counts[s]}
        </div>`
      ).join("")}
    </li>
  `;

  sidebarAllClients = list;
  sidebarSearchTerm = term;
  sidebarRenderCount = 0;

  clientList.innerHTML =
    countsHTML +
    `<li id="clientListItems" style="list-style:none; padding:0; margin:0;"></li>`;
  sidebarListContainer = document.getElementById("clientListItems");
  renderSidebarChunk();

  selectedIndex = -1;
}

function buildClientCard(c, term = "") {
  const [fName, ...rest] = (c.name || "").split(" ");
  const lName = rest.join(" ");
  const color = STATUS_COLORS[c.status] || "#2563eb";
  const displayName = `${fName || ""} ${lName || ""}`.trim();
  const safeDisplayName = escapeHtml(displayName);
  const displayPhone = c.phone || "";
  const safeTerm = term ? term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const nameHighlighted = safeTerm
    ? safeDisplayName.replace(new RegExp(safeTerm, "ig"), (m) => `<mark>${m}</mark>`)
    : safeDisplayName;
  const phoneHighlighted = safeTerm
    ? escapeHtml(displayPhone).replace(new RegExp(safeTerm, "ig"), (m) => `<mark>${m}</mark>`)
    : escapeHtml(displayPhone);

  var clientTypeBadge = '';
  if (c.client_type === 'recurring') {
    clientTypeBadge = '<span class="client-type-badge recurring" data-filter-type="recurring" title="Click to search Recurring clients">Recurring</span>';
  } else if (c.client_type === 'one-off') {
    clientTypeBadge = '<span class="client-type-badge one-off" data-filter-type="one-off" title="Click to search One-Off clients">One-Off</span>';
  }

  // Portal link badge — only shown for recurring clients when
  // the client portal platform feature is active.
  // FUTURE: Replace with actual portal link once the client portal
  // feature sprint is complete.  The badge serves as a visual anchor
  // for the upcoming portal link feature.
  var portalBadge = '';
  if (c.client_type === 'recurring' && window._platformFeatures && window._platformFeatures.clientPortal === true) {
    portalBadge = '<span class="client-type-badge portal" style="background:var(--primary-soft);color:var(--primary);border:1px solid var(--primary);">Portal</span>';
  }

  var retentionBadge = '';
  if (c.client_type === 'recurring' && window._retentionRiskIds && window._retentionRiskIds.indexOf(c.id) !== -1) {
    retentionBadge = '<span class="retention-risk-badge">Retention Risk</span>';
  }

  return `
    <div class="client-card" data-id="${c.id}" data-name="${displayName}" style="border-left:4px solid ${color};">
      <div class="client-name">
        ${nameHighlighted}
        ${clientTypeBadge}
        ${portalBadge}
        ${retentionBadge}
      </div>

      <div class="client-meta">
        <i data-lucide="phone"></i> ${phoneHighlighted}
      </div>

      ${c.email ? `<div class="client-meta" style="font-size:0.82rem;"><i data-lucide="mail"></i> ${c.email}</div>` : ''}

      <div class="client-status" style="background:${color}2e; color:${color}; border:1px solid ${color}70;" data-filter-status="${escapeHtml(c.status || "Lead")}" title="Click to search this status">
        ${escapeHtml(c.status || "Lead")}
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

  const html = next.map(c => buildClientCard(c, sidebarSearchTerm)).join("");
  sidebarListContainer.insertAdjacentHTML("beforeend", html);
  if (window.lucide) window.lucide.createIcons();
}

// ======================================================
// OPEN CLIENT PANEL
// ======================================================
async function openClient(id) {
  if (!id) return;
  activeId = id;
  try {
    const clients = await window.api.searchClients("");
    const client = clients.find(c => c.id == id);
    if (!client) return;
    activeClient = client;
    projectPanel.dataset.clientName = client.name || "";

    const [fName, ...rest] = (client.name || "").split(" ");
    const lName = rest.join(" ");
    const mapsLink = client.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`
      : "";

    // Pre-fill scope from company default if client has none saved yet
    let initialScope = client.scope_of_work || "";
    if (!initialScope) {
      try {
        const profile = await window.api.getCompanyProfile();
        initialScope = profile?.settings?.defaultScopeOfWork || "";
      } catch (e) { /* silently skip */ }
    }

    projectPanel.innerHTML = `
      <div class="detail-card animate-panel panel-shell" style="opacity:0; transform:translateY(-20px); transition:0.25s ease;">
        <button id="closeBtn" class="close-x">&times;</button>
        <header class="detail-header panel-header">
          <div class="panel-title-block">
            <div class="panel-kicker">Client Workspace</div>
            <h2 style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              ${escapeHtml(fName || "")} ${escapeHtml(lName || "")}
              <span style="
                font-size:0.7rem; font-weight:700; letter-spacing:0.1em; text-transform:uppercase;
                padding:4px 10px; border-radius:var(--radius-sm); white-space:nowrap;
                background:${STATUS_COLORS[client.status] || '#2563eb'}2e;
                color:${STATUS_COLORS[client.status] || '#2563eb'};
                border:1px solid ${STATUS_COLORS[client.status] || '#2563eb'}70;
              ">${escapeHtml(client.status || 'Lead')}</span>
            </h2>
            <div class="panel-subtitle">Core contact, financial, and document details stay in one place.</div>
          </div>
          <div class="contact-quick-links panel-contact-links">
            <span><i data-lucide="phone"></i> <a href="tel:${encodeURIComponent(client.phone || "")}">${escapeHtml(client.phone || "")}</a></span>
            <span><i data-lucide="mail"></i> <a href="mailto:${encodeURIComponent(client.email || "")}">${escapeHtml(client.email || "")}</a></span>
          </div>
          <span id="saveStatus" class="save-status-chip">Saved</span>
        </header>

        <div class="details-grid panel-grid">

          <!-- ===== ADD JOB ===== -->
          <div class="panel-full-span add-job-row" style="margin-bottom:2px;">
            <button id="quick-add-job-btn" class="btn-primary add-job-btn"
              style="font-weight:700;">
              + Job
            </button>
          </div>

          <!-- ===== CASH AGGREGATE TRACKER (admin only — Section 8) ===== -->
          ${isAdminUser() ? `
          <div class="panel-section panel-full-span" style="padding-top:0; padding-bottom:0; margin-bottom:6px;">
            <div class="panel-balance-row" style="background:var(--surface-muted); border:1px solid var(--border-soft); border-radius:12px; padding:10px 16px;">
              <div class="panel-metric">
                <span>Total Cash Collected</span>
                <strong id="cashAggregateDisplay" style="font-family:'Courier New',monospace; font-size:1.3rem; font-weight:800;">$0.00</strong>
              </div>
              <div class="panel-metric">
                <span>Jobs</span>
                <strong id="cashJobCountDisplay" style="font-size:1.3rem;">0</strong>
              </div>
            </div>
          </div>
          ` : ''}

          <div class="panel-full-span client-stage-field">
            <label>Client Stage</label>
            <select id="p-status">
              ${STATUS_ORDER.map(s =>
                `<option value="${s}" ${client.status === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
            <span class="field-hint">The client's overall pipeline stage. Individual jobs have their own separate tags below.</span>
          </div>

          <label>Job Address</label>
          <div class="field-stack">
            <input type="text" id="p-address" value="${client.address || ""}">
            ${client.address
              ? `<a href="${mapsLink}" target="_blank" class="maps-link"><i data-lucide="map-pin"></i> Open in Google Maps</a>`
              : ""}
          </div>

          <label>Phone Number</label>
          <input type="tel" id="p-phone" value="${client.phone || ""}">

          <label>Email Address</label>
          <input type="email" id="p-email" value="${client.email || ""}">

          <!-- ===== ASSIGNED SALESPERSON ===== -->
          <div class="panel-full-span" id="assigned-user-field">
            <label>Assigned To</label>
            ${isAdminUser()
              ? `<select id="p-assigned-user"><option value="">Loading users...</option></select>`
              : `<div class="job-modal-readout">${escapeHtml((window.__USER__ && window.__USER__.displayName) || (window.__USER__ && window.__USER__.email) || 'You')}</div>`}
          </div>

          <!-- ===== FINANCIAL OVERVIEW + JOB COST & MARGIN (admin only — Section 8) ===== -->
          <!-- Regular users never receive total_due/amount_paid/balance/job_cost
               from the API (see api/access-control.js sanitizeClient), so this
               markup is also skipped entirely for them rather than merely hidden. -->
          ${isAdminUser() ? `
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Financial Overview</h3>
              <span class="panel-section-note">Track totals, payments, and remaining balance.</span>
            </div>

            <div class="panel-inline-row">
              <input type="text" id="totalDueInput" placeholder="Total Due"
                inputmode="decimal" class="panel-money-input" ${client.total_due ? `value="${formatMoney(client.total_due)}"` : ''}>
              <button id="saveTotalBtn" class="btn-primary" style="background:var(--primary);">Save</button>
            </div>

            <div class="panel-balance-row">
              <div class="panel-metric">
                <span>Amount Paid</span>
                <strong id="amountPaidDisplay">$${formatMoney(client.amount_paid || 0)}</strong>
              </div>
              <div class="panel-metric">
                <span>Balance</span>
                <strong id="balanceDisplay">$${formatMoney(client.balance || 0)}</strong>
              </div>
            </div>

            <div class="panel-inline-row">
              <input type="text" id="paymentInput" placeholder="Add Payment"
                inputmode="decimal" class="panel-money-input">
              <button id="addPaymentBtn" class="btn-primary" style="background:var(--primary);">Add Payment</button>
              <button id="undoFinanceBtn" class="btn-primary" style="background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft);">Undo Payment</button>
            </div>
          </div>

          <!-- ===== JOB COST & MARGIN ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Job Cost &amp; Margin</h3>
              <span class="panel-section-note">Total price minus job cost equals your margin.</span>
            </div>
            <div class="panel-inline-row">
              <input type="text" id="jobCostInput" placeholder="Job Cost"
                inputmode="decimal" class="panel-money-input"
              value="${client.job_cost ? formatMoney(client.job_cost) : ''}">
            </div>
            <div class="panel-balance-row">
              <div class="panel-metric">
                <span>Job Cost</span>
                <strong id="jobCostDisplay">$${formatMoney(client.job_cost || 0)}</strong>
              </div>
              <div class="panel-metric">
                <span>Margin $</span>
                <strong id="marginDollarDisplay">${(function() {
                  const t = Number(client.total_due || 0);
                  const c2 = Number(client.job_cost || 0);
                  return '$' + formatMoney(t - c2);
                })()}</strong>
              </div>
              <div class="panel-metric">
                <span>Margin %</span>
                <strong id="marginPctDisplay">${(function() {
                  const t = Number(client.total_due || 0);
                  const c2 = Number(client.job_cost || 0);
                  if (t <= 0) return '—';
                  return Math.round(((t - c2) / t) * 100) + '%';
                })()}</strong>
              </div>
            </div>
          </div>
          ` : ''}

          <!-- ===== SCOPE OF WORK ===== -->
          <div class="panel-section panel-full-span">
            <div class="panel-section-header">
              <h3>Scope of Work</h3>
              <span class="panel-section-note">Services assigned to this client. Pulled onto invoices.</span>
            </div>
            <div id="scope-services-list" style="display:flex; flex-wrap:wrap; gap:6px; min-height:32px; margin-bottom:8px;">
              <div style="color:var(--text-muted); font-size:0.85rem; width:100%;">Loading scope items...</div>
            </div>
            <div style="display:flex; gap:6px;">
              <button id="add-scope-service-btn" class="btn-primary"
                style="background:var(--primary); flex:1; padding:8px;">
                + Add Service
              </button>
              <button id="manage-services-btn" class="btn-primary"
                style="background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft); flex:1; padding:8px; display:none;">
                Manage Presets
              </button>
            </div>
            <!-- Hidden textarea for backward compatibility with save/invoice -->
            <textarea id="p-scope" style="display:none;">${escapeHtml(initialScope)}</textarea>
          </div>

          <div id="pdf-drop-zone" class="drop-zone"
            style="grid-column: span 2;"><i data-lucide="file-text"></i> Drop Client PDFs Here</div>

          <button id="pdf-upload-btn"
            type="button"
            class="panel-secondary-btn"
            style="grid-column: span 2; margin-top:8px; background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft); border:none; padding:8px; border-radius:6px; cursor:pointer;">
            Upload PDF</button>

          <input type="file"
            id="pdf-file-input"
            accept=".pdf,application/pdf"
            multiple
            hidden />

          <div id="pdf-list"
            class="panel-full-span panel-list"></div>

          <div id="notes-section" class="notes-section panel-full-span">
            <div class="panel-section-header">
              <h3>Client Notes</h3>
              <span class="panel-section-note">Use notes for site visits, follow-ups, and reminders.</span>
            </div>
            <div id="notes-list" class="notes-list"></div>
            <div class="notes-actions">
              <textarea id="new-note-input" placeholder="Add a note..." rows="6"></textarea>
              <button id="add-note-btn" class="btn-primary add-note-btn" style="background:var(--primary);">Add Note</button>
            </div>
          </div>

          <!-- ===== JOBS SECTION ===== -->
          <div class="panel-section panel-full-span" id="jobs-section">
            <div class="panel-section-header">
              <h3>Jobs</h3>
              <span class="panel-section-note">Each job has its own scope, financials, and documents.</span>
            </div>
            <div id="jobs-list" style="display:flex; flex-direction:column; gap:10px;"></div>
          </div>

          <div class="panel-actions panel-full-span">
            ${isAdminUser() ? `
            <button id="estimateBtn" class="btn-primary" style="flex:2;">Download Estimate</button>
            <button id="invoiceBtn" class="btn-primary" style="background:var(--primary); flex:2;">Download Invoice</button>` : ''}
            <button id="reviewBtn" class="btn-primary" style="background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft); flex:2;">Send Google Review</button>
            <button id="saveBtn" class="btn-primary" style="background:var(--primary); flex:2;">Save Changes</button>
            <button id="delBtn" class="btn-primary" style="background:var(--danger-soft); color:var(--danger); border:1px solid var(--danger-soft); flex:1;">Delete</button>
            <button id="printBtn" class="btn-primary" style="background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft); flex:1;">Print</button>
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


    setupDropZone();
    setupPDFUploadButton();
    loadPDFs(id);
    setupFinancialSection(client);
    setupNotesSection(id);
    setupJobsSection(id);
    setupQuickAddJob(id);
    loadCashAggregate(id);
    setupScopeServices(id);
    setupAssignedUserField(id, client.assigned_user_id);
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

  } catch (err) {
    console.error(err);
  }
}


// ======================================================
// FINANCIAL SECTION
// ======================================================
function setupFinancialSection(client) {
  const saveTotalBtn = document.getElementById("saveTotalBtn");
  const addPaymentBtn = document.getElementById("addPaymentBtn");
  const totalDueInput = document.getElementById("totalDueInput");
  const paymentInput = document.getElementById("paymentInput");

  // Financial Overview isn't rendered for regular users (Section 8) —
  // nothing to wire up.
  if (!saveTotalBtn || !addPaymentBtn) return;

  applyMoneyInputBehavior(totalDueInput);
  applyMoneyInputBehavior(paymentInput);

  // ==============================
  // SAVE TOTAL
  // ==============================
  saveTotalBtn.onclick = async () => {
    if (saveTotalBtn.disabled) return;
    try {
      saveTotalBtn.disabled = true;
      const newTotal = parseMoney(totalDueInput?.value) || 0;

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid,
        balance: client.balance
      });

      await window.api.updateTotal(activeId, newTotal);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      showToast("Total updated", "success");
    } catch (err) {
      console.error(err);
      showToast(err?.message || "Failed to update total", "error");
    } finally {
      saveTotalBtn.disabled = false;
    }
  };

  // ==============================
  // ADD PAYMENT
  // ==============================
  addPaymentBtn.onclick = async () => {
    if (addPaymentBtn.disabled) return;
    try {
      addPaymentBtn.disabled = true;
      const payment = parseMoney(paymentInput?.value) || 0;
      if (payment <= 0) {
        showToast("Enter a valid payment", "error");
        return;
      }

      // 🧠 Save PREVIOUS state to undo stack
      financeUndoStack.push({
        clientId: activeId,
        total_due: client.total_due,
        amount_paid: client.amount_paid,
        balance: client.balance
      });

      await window.api.addPayment(activeId, payment);

      await refreshList();
      await openClient(activeId);

      triggerFinanceUpdate();

      showToast("Payment added", "success");
    } catch (err) {
      console.error(err);
      showToast(err?.message || "Failed to add payment", "error");
    } finally {
      addPaymentBtn.disabled = false;
    }
  };
}

// If the client panel is closed with a valid, unsubmitted amount still sitting
// in the Payment input (i.e. the user typed one but never clicked "Add
// Payment"), save it before closing instead of silently discarding it. A
// blank/invalid input is left alone — no record is created.
async function autoSavePendingClientPayment() {
  const paymentInput = document.getElementById("paymentInput");
  if (!paymentInput || !activeId) return;
  const raw = paymentInput.value.trim();
  if (!raw) return;
  const amount = parseMoney(raw);
  if (!Number.isFinite(amount) || amount <= 0) return;

  try {
    financeUndoStack.push({
      clientId: activeId,
      total_due: activeClient?.total_due,
      amount_paid: activeClient?.amount_paid,
      balance: activeClient?.balance
    });
    await window.api.addPayment(activeId, amount);
    await refreshList();
    triggerFinanceUpdate();
  } catch (err) {
    console.error(err);
    showToast("Failed to save payment", "error");
  }
}

// ======================================================
// SAVE STATUS UI
// ======================================================
function setSaveStatus(state) {
  const el = document.getElementById("saveStatus");
  if (!el) return;

  if (state === "saving") {
    el.textContent = "Saving…";
    el.style.color = "#ffd37a";
    return;
  }

  if (state === "error") {
    el.textContent = "Save failed";
    el.style.color = "#ff9aa2";
    return;
  }

  if (state === "unsaved") {
    el.textContent = "Unsaved changes";
    el.style.color = "#ffcc66";
    return;
  }

  el.textContent = "Saved";
  el.style.color = "#9ad0ff";
}

function markDirty() {
  setSaveStatus("unsaved");
}

function setupDirtyTracking() {
  const statusEl = document.getElementById("p-status");
  const addrEl = document.getElementById("p-address");
  const phoneEl = document.getElementById("p-phone");
  const emailEl = document.getElementById("p-email");
  const totalDueEl = document.getElementById("totalDueInput");
  const newNoteInput = document.getElementById("new-note-input");
  const scopeEl = document.getElementById("p-scope");
  const jobCostEl = document.getElementById("jobCostInput");

  [statusEl, addrEl, phoneEl, emailEl, totalDueEl, newNoteInput, scopeEl, jobCostEl].forEach(el => {
    if (!el) return;
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });

  // Live margin calculation when job cost changes
  if (jobCostEl) {
    const updateMargin = () => {
      const totalInput = document.getElementById("totalDueInput");
      const total = parseMoney(totalInput?.value) || Number(activeClient?.total_due || 0);
      const cost = parseMoney(jobCostEl.value) || 0;
      const marginDollar = total - cost;
      const marginPct = total > 0 ? Math.round((marginDollar / total) * 100) : null;

      const dollarEl = document.getElementById("marginDollarDisplay");
      const pctEl = document.getElementById("marginPctDisplay");
      const costDisplay = document.getElementById("jobCostDisplay");

      if (dollarEl) dollarEl.textContent = "$" + formatMoney(marginDollar);
      if (pctEl) pctEl.textContent = marginPct !== null ? marginPct + "%" : "—";
      if (costDisplay) costDisplay.textContent = "$" + formatMoney(cost);
    };

    jobCostEl.addEventListener("input", updateMargin);

    // Also update margin when total due changes
    const totalDueEl2 = document.getElementById("totalDueInput");
    if (totalDueEl2) totalDueEl2.addEventListener("input", updateMargin);
  }
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
        editBtn.style.background = "var(--primary)";
        editBtn.style.color = "#fff";
        editBtn.style.border = "none";
        editBtn.style.padding = "4px 8px";
        editBtn.style.borderRadius = "4px";
        editBtn.style.cursor = "pointer";

        const deleteBtn = document.createElement("button");
        deleteBtn.innerText = "Delete";
        deleteBtn.style.background = "#4a5568";
        deleteBtn.style.color = "#fff";
        deleteBtn.style.border = "none";
        deleteBtn.style.padding = "4px 8px";
        deleteBtn.style.borderRadius = "4px";
        deleteBtn.style.cursor = "pointer";

        editBtn.onclick = async () => {
          const current = note.content || "";
          const textarea = document.createElement("textarea");
          textarea.value = current;
          textarea.rows = 4;
          textarea.style.flex = "1";
          textarea.style.padding = "6px 8px";
          textarea.style.resize = "vertical";
          textarea.style.background = "var(--surface)";
          textarea.style.color = "var(--text-main)";
          textarea.style.border = "1px solid var(--border-soft)";
          textarea.style.borderRadius = "4px";
          textarea.style.fontFamily = "inherit";
          textarea.dataset.noteId = note.id;
          textarea.dataset.clientId = clientId;
          textarea.dataset.original = current;

          const saveBtn = document.createElement("button");
          saveBtn.innerText = "Save";
          saveBtn.style.background = "var(--primary)";
          saveBtn.style.color = "#fff";
          saveBtn.style.border = "none";
          saveBtn.style.padding = "4px 8px";
          saveBtn.style.borderRadius = "4px";
          saveBtn.style.cursor = "pointer";
          saveBtn.style.marginLeft = "6px";

          const cancelBtn = document.createElement("button");
          cancelBtn.innerText = "Cancel";
          cancelBtn.style.background = "var(--surface-muted)";
          cancelBtn.style.color = "var(--text-main)";
          cancelBtn.style.border = "1px solid var(--border-soft)";
          cancelBtn.style.padding = "4px 8px";
          cancelBtn.style.borderRadius = "4px";
          cancelBtn.style.cursor = "pointer";
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
// JOBS SECTION
// ======================================================
async function setupJobsSection(clientId) {
  const jobsList = document.getElementById('jobs-list');
  if (!jobsList) return;

  const STATUS_COLORS_JOB = {
    Prospect: '#7c3aed', Approved: '#0e7490', Completed: '#b45309',
    Invoice: '#2563eb', Closed: '#15803d'
  };

  async function loadJobs() {
    jobsList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Loading jobs...</div>';
    try {
      const data = await window.api.listJobs(clientId);
      const jobs = data.jobs || [];
      jobsList.innerHTML = '';

      if (jobs.length === 0) {
        jobsList.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No jobs yet. Create one above.</div>';
        return;
      }

      jobs.forEach(job => {
        const color = STATUS_COLORS_JOB[job.status] || '#2563eb';
        const jobCardAdmin = isAdminUser();
        // job_cost is stripped server-side for regular users (see
        // api/access-control.js), so margin can only be shown to admins —
        // total_due/balance are visible to everyone.
        const margin = jobCardAdmin && job.total_due > 0
          ? Math.round(((job.total_due - job.job_cost) / job.total_due) * 100)
          : null;

        const card = document.createElement('div');
        card.style.cssText = `
          background:var(--surface-muted); border:1px solid var(--border-soft);
          border-left:4px solid ${color}; border-radius:12px; padding:14px 16px;
          cursor:pointer; transition:all 0.2s ease;
        `;
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;color:var(--text-main);font-size:0.95rem;">${escapeHtml(job.title || 'Untitled Job')}</div>
              <div style="font-size:0.82rem;color:var(--text-muted);margin-top:3px;">
                Created ${new Date(job.created_at).toLocaleDateString()}
                ${margin !== null ? ` &nbsp;·&nbsp; Margin: ${margin}%` : ''}
              </div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                color:${color};background:${color}2e;border:1px solid ${color}70;
                padding:3px 8px;border-radius:var(--radius-sm);display:inline-block;margin-bottom:4px;">
                ${escapeHtml(job.status)}
              </div>
              <div style="font-size:0.9rem;font-weight:700;color:var(--text-main);">
                $${formatMoney(job.total_due)}
              </div>
              <div style="font-size:0.78rem;color:var(--text-muted);">
                Bal: $${formatMoney(job.balance)}
              </div>
            </div>
          </div>
        `;

        card.addEventListener('mouseenter', () => {
          card.style.borderColor = `rgba(71,167,245,0.55)`;
          card.style.transform = 'translateY(-1px)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.borderColor = `var(--border-soft)`;
          card.style.borderLeftColor = color;
          card.style.transform = '';
        });

        card.addEventListener('click', () => openJobPanel(job, clientId, loadJobs));
        jobsList.appendChild(card);
      });
    } catch (err) {
      console.error(err);
      jobsList.innerHTML = '<div style="color:#ff9aa2;font-size:13px;">Failed to load jobs.</div>';
    }
  }

  loadJobs();
}

// ======================================================
// + JOB (Section 4/5) — opens a dedicated creation modal instead of
// a bare title field, so the new job's Scope of Work can be reviewed
// (and, per Section 4, defaults to THIS CLIENT's own saved scope —
// not the company-wide default) before the job is created.
// ======================================================
function setupQuickAddJob(clientId) {
  const btn = document.getElementById('quick-add-job-btn');
  if (!btn) return;
  btn.onclick = function () {
    openNewJobModal(clientId);
  };
}

async function openNewJobModal(clientId) {
  const existing = document.getElementById('newJobModalOverlay');
  if (existing) existing.remove();

  // Gather copy-from candidates: this client's own default scope,
  // the company-wide fallback default, and this client's existing jobs.
  let clientDefaultScope = '';
  let companyDefaultScope = '';
  let existingJobs = [];
  try {
    clientDefaultScope = (activeClient && activeClient.scope_of_work) || '';
  } catch (e) { /* skip */ }
  try {
    const profile = await window.api.getCompanyProfile();
    companyDefaultScope = profile?.settings?.defaultScopeOfWork || '';
  } catch (e) { /* skip */ }
  try {
    const data = await window.api.listJobs(clientId);
    existingJobs = data.jobs || [];
  } catch (e) { /* skip */ }

  // Section 4: the new job's scope should default to the CLIENT's own
  // saved scope of work. Only fall back to the company default when the
  // client has none saved yet.
  const initialScope = clientDefaultScope || companyDefaultScope || '';
  const initialSource = clientDefaultScope ? 'client' : (companyDefaultScope ? 'company' : 'blank');

  const overlay = document.createElement('div');
  overlay.id = 'newJobModalOverlay';
  overlay.className = 'job-modal-overlay';

  const copyOptions = [
    `<option value="blank" ${initialSource === 'blank' ? 'selected' : ''}>Start blank</option>`,
    `<option value="client" ${initialSource === 'client' ? 'selected' : ''} ${clientDefaultScope ? '' : 'disabled'}>Client's default scope</option>`,
    `<option value="company" ${initialSource === 'company' ? 'selected' : ''} ${companyDefaultScope ? '' : 'disabled'}>Company default scope</option>`,
    ...existingJobs.map((j) => `<option value="job-${j.id}">Copy from: ${escapeHtml(j.title || 'Untitled job')}</option>`)
  ].join('');

  overlay.innerHTML = `
    <div class="job-modal-card">
      <button id="closeNewJobModal" class="job-modal-close">&times;</button>
      <div class="job-modal-kicker">New Job</div>

      <div class="job-modal-field">
        <label for="new-job-title">Job name</label>
        <input id="new-job-title" type="text" placeholder="e.g. Roof Replacement" maxlength="200">
      </div>

      <div class="job-modal-grid">
        <div class="job-modal-field">
          <label for="new-job-status">Job status</label>
          <select id="new-job-status">
            ${['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'].map((s) => `<option value="${s}" ${s === 'Prospect' ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="job-modal-field">
          <label for="new-job-copy-from">Copy scope/pricing from&hellip;</label>
          <select id="new-job-copy-from">${copyOptions}</select>
        </div>
      </div>

      <div class="job-modal-field">
        <label for="new-job-scope">Scope of Work</label>
        <textarea id="new-job-scope" rows="5" placeholder="Describe the work for this job...">${escapeHtml(initialScope)}</textarea>
        <span class="field-hint">Pre-filled from this client's default scope. Edit freely — it's saved as this job's own copy.</span>
      </div>

      <div class="job-modal-field">
        <label for="new-job-notes">Notes</label>
        <textarea id="new-job-notes" rows="4" placeholder="Anything worth noting about this job — site details, customer preferences, follow-ups..."></textarea>
        <span class="field-hint">Optional. Shows up on this job's Notes section right away.</span>
      </div>

      <div class="job-modal-actions">
        <button id="createJobBtn" class="btn-primary">Add Job</button>
        <button id="cancelNewJobBtn" class="btn-primary" style="background:var(--surface-muted); color:var(--text-main); border:1px solid var(--border-soft);">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const scopeEl = overlay.querySelector('#new-job-scope');
  const copyFromEl = overlay.querySelector('#new-job-copy-from');
  const titleEl = overlay.querySelector('#new-job-title');

  copyFromEl.addEventListener('change', () => {
    const value = copyFromEl.value;
    if (value === 'blank') {
      scopeEl.value = '';
    } else if (value === 'client') {
      scopeEl.value = clientDefaultScope;
    } else if (value === 'company') {
      scopeEl.value = companyDefaultScope;
    } else if (value.startsWith('job-')) {
      const jobId = value.slice(4);
      const job = existingJobs.find((j) => String(j.id) === jobId);
      if (job) scopeEl.value = job.scope_of_work || '';
    }
  });

  overlay.querySelector('#closeNewJobModal').onclick = () => overlay.remove();
  overlay.querySelector('#cancelNewJobBtn').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#createJobBtn').onclick = async () => {
    const createBtn = overlay.querySelector('#createJobBtn');
    try {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';

      const result = await window.api.createJob({
        client_id: clientId,
        title: titleEl.value.trim() || 'New Job',
        status: overlay.querySelector('#new-job-status').value,
        // This job gets its OWN saved copy of the scope text right now.
        // Later edits to the client's default scope will never rewrite
        // this job's scope after the fact.
        scope_of_work: scopeEl.value,
        total_due: 0,
        job_cost: 0
      });

      const notesText = overlay.querySelector('#new-job-notes').value.trim();
      if (notesText && result.job) {
        try {
          await window.api.addJobNote(result.job.id, notesText);
        } catch (err) {
          console.error(err);
          showToast('Job created, but the note could not be saved', 'error');
        }
      }

      showToast('Job created', 'success');
      overlay.remove();
      await setupJobsSection(clientId);

      if (result.job) {
        openJobPanel(result.job, clientId, function () {
          setupJobsSection(clientId);
        });
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to create job', 'error');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Add Job';
    }
  };

  setTimeout(() => titleEl.focus(), 50);
}

// ======================================================
// CASH AGGREGATE TRACKER
// ======================================================
async function loadCashAggregate(clientId) {
  const displayEl = document.getElementById('cashAggregateDisplay');
  const countEl = document.getElementById('cashJobCountDisplay');
  if (!displayEl) return;

  try {
    const data = await window.api.getClientCashAggregate(clientId);
    if (data && data.success) {
      displayEl.textContent = '$' + formatMoney(data.totalCashCollected);
      if (countEl) countEl.textContent = data.jobCount || 0;
    }
  } catch (err) {
    console.error(err);
    displayEl.textContent = '$0.00';
  }
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
    const res = await fetch('/api/v2/admin/users');
    if (!res.ok) throw new Error('Failed to load users');
    const data = await res.json();
    const users = data.data || [];

    select.innerHTML = '<option value="">Unassigned</option>' +
      users.map((u) => `<option value="${u.id}" ${String(u.id) === String(currentAssignedUserId) ? 'selected' : ''}>${escapeHtml(u.display_name || u.email)}</option>`).join('');

    select.onchange = async () => {
      try {
        await fetch(`/api/clients/${clientId}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_user_id: select.value || null })
        });
        showToast('Client reassigned', 'success');
        await refreshList();
      } catch (err) {
        console.error(err);
        showToast('Failed to reassign client', 'error');
      }
    };
  } catch (err) {
    console.error(err);
    select.innerHTML = '<option value="">Could not load users</option>';
  }
}

async function setupScopeServices(clientId) {
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
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;width:100%;">No services assigned. Click "+ Add Service".</div>';
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
          rateSpan.style.cssText = 'font-family:\'Courier New\',monospace;font-weight:700;color:var(--accent);margin-left:2px;';
          rateSpan.textContent = '$' + formatMoney(rate);
          chip.appendChild(rateSpan);
        }

        var removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText =
          'border:none;background:transparent;color:rgba(255,150,150,0.8);' +
          'cursor:pointer;font-size:1.1rem;line-height:1;padding:0 2px;margin-left:2px;';
        removeBtn.title = 'Remove ' + cs.serviceName;
        removeBtn.onclick = async function () {
          try {
            await window.api.removeClientService(clientId, cs.id);
            showToast(cs.serviceName + ' removed', 'success');
            await loadScopeServices();
            await updateScopeHiddenField();
            markDirty();
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
      listEl.innerHTML = '<div style="color:#ff9aa2;font-size:0.85rem;width:100%;">Failed to load services.</div>';
    }
  }

  addBtn.onclick = function () {
    openServicePicker(clientId, function () {
      loadScopeServices();
      updateScopeHiddenField();
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
      '<button id="closeServicePicker" style="' +
        'position:absolute;top:12px;right:14px;border:none;background:transparent;' +
        'color:var(--accent);font-size:1.5rem;cursor:pointer;line-height:1;' +
      '">&times;</button>' +
      '<div style="font-size:0.75rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px;">Add Services</div>' +
      '<h3 style="margin:0 0 16px;font-size:1.1rem;">Select services to add to scope</h3>' +
      '<div id="servicePickerList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">' +
        '<div style="color:var(--text-muted);">Loading services...</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="servicePickerSaveBtn" class="btn-primary" style="background:var(--primary);flex:1;padding:10px;">Add Selected</button>' +
        '<button id="servicePickerCancelBtn" class="btn-primary" style="background:var(--surface-muted);color:white;flex:1;padding:10px;">Cancel</button>' +
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
        cb.style.cssText = 'width:18px;height:18px;accent-color:#4f8dfd;cursor:pointer;';
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
        rateSpan.style.cssText = 'font-family:\'Courier New\',monospace;font-weight:700;color:var(--accent);font-size:0.9rem;';
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
      listEl.innerHTML = '<div style="color:#ff9aa2;">Failed to load services.</div>';
    }
  }

  loadServices();
}

// ======================================================
// ADMIN: MANAGE SERVICE PRESETS MODAL
// ======================================================
function openManageServicesModal(onSave) {
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
      '<button id="closeManageServices" style="' +
        'position:absolute;top:12px;right:14px;border:none;background:transparent;' +
        'color:var(--accent);font-size:1.5rem;cursor:pointer;line-height:1;' +
      '">&times;</button>' +
      '<div style="font-size:0.75rem;letter-spacing:0.18em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px;">Admin</div>' +
      '<h3 style="margin:0 0 4px;font-size:1.1rem;">Manage Service Presets</h3>' +
      '<p style="font-size:0.85rem;color:var(--text-muted);margin:0 0 16px;">Add, edit, or remove global service options.</p>' +

      '<div style="display:flex;gap:8px;margin-bottom:16px;">' +
        '<input id="newSvcName" type="text" placeholder="Service name (e.g. Mowing)"' +
          'style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text-main);font-size:0.95rem;">' +
        '<input id="newSvcRate" type="text" inputmode="decimal" placeholder="Rate"' +
          'style="width:100px;padding:10px 14px;border-radius:10px;border:1px solid var(--border-strong);background:var(--surface);color:var(--text-main);font-size:0.95rem;">' +
        '<button id="addSvcBtn" class="btn-primary" style="padding:10px 16px;white-space:nowrap;">Add</button>' +
      '</div>' +

      '<div id="manageServicesList" style="display:flex;flex-direction:column;gap:6px;">' +
        '<div style="color:var(--text-muted);">Loading...</div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button id="manageServicesDoneBtn" class="btn-primary" style="background:var(--surface-muted);color:white;flex:1;padding:10px;">Done</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  overlay.querySelector('#closeManageServices').onclick = function () { overlay.remove(); };
  overlay.querySelector('#manageServicesDoneBtn').onclick = function () { overlay.remove(); };
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

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
            (svc.isActive ? '' : ' <span style="color:#ff9aa2;font-size:0.75rem;">(inactive)</span>') +
          '</div>' +
          (svc.description ? '<div style="font-size:0.78rem;color:var(--text-muted);">' + escapeHtml(svc.description) + '</div>' : '');

        var rateSpan = document.createElement('div');
        rateSpan.style.cssText = 'font-family:\'Courier New\',monospace;font-weight:700;color:var(--accent);font-size:0.9rem;padding:0 8px;';
        rateSpan.textContent = svc.defaultRate > 0 ? '$' + formatMoney(svc.defaultRate) : '';

        var toggleActiveBtn = document.createElement('button');
        toggleActiveBtn.textContent = svc.isActive ? 'Deactivate' : 'Activate';
        toggleActiveBtn.style.cssText =
          'border:none;background:var(--surface-muted);color:var(--text-main);' +
          'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.78rem;';
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
        editBtn.style.cssText =
          'border:none;background:rgba(47,128,237,0.2);color:#4f8dfd;' +
          'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.78rem;';

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
        delBtn.style.cssText =
          'border:none;background:rgba(255,100,100,0.15);color:#ff9aa2;' +
          'padding:4px 10px;border-radius:6px;cursor:pointer;font-size:0.78rem;';
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
      listEl.innerHTML = '<div style="color:#ff9aa2;">Failed to load services.</div>';
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
// JOB PANEL (modal overlay)
// ======================================================
const JOB_LINE_ITEM_CATEGORIES = ['Labor', 'Materials', 'Commissions', 'Meals/Drinks', 'Miscellaneous', 'Permits'];

function openJobPanel(job, clientId, onSave) {
  // Remove any existing job panel
  const existing = document.getElementById('jobPanelOverlay');
  if (existing) existing.remove();

  const STATUS_ORDER_JOB = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed'];
  const admin = isAdminUser();
  const tags = Array.isArray(job.tags) ? job.tags : [];

  const overlay = document.createElement('div');
  overlay.id = 'jobPanelOverlay';
  overlay.className = 'job-modal-overlay';

  overlay.innerHTML = `
    <div id="jobPanelCard" class="job-modal-card">
      <button id="closeJobPanel" class="job-modal-close">&times;</button>
      <div class="job-modal-kicker">Job Details</div>

      <div class="job-modal-field">
        <input id="job-title" type="text" class="job-title-input" value="${escapeHtml(job.title || 'New Job')}">
      </div>

      <div class="job-modal-grid">
        <div class="job-modal-field">
          <label>Status</label>
          <select id="job-status">
            ${STATUS_ORDER_JOB.map(s => `<option value="${s}" ${job.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="job-modal-field">
          <label>Job Total</label>
          ${admin
            ? `<input id="job-total" type="text" inputmode="decimal" value="${formatMoney(job.total_due)}">`
            : `<div class="job-modal-readout">$${formatMoney(job.total_due)}</div>`}
        </div>
        ${admin ? `
        <div class="job-modal-field">
          <label>Job Cost</label>
          <input id="job-cost" type="text" inputmode="decimal" value="${formatMoney(job.job_cost)}">
        </div>
        <div class="job-modal-field">
          <label>Profit</label>
          <div id="job-profit-display" class="job-modal-readout">
            $${formatMoney(Number(job.total_due || 0) - Number(job.job_cost || 0))}
          </div>
        </div>
        <div class="job-modal-field">
          <label>Margin</label>
          <div id="job-margin-display" class="job-modal-readout">
            ${job.total_due > 0 ? Math.round(((job.total_due - job.job_cost) / job.total_due) * 100) + '%' : '—'}
          </div>
        </div>` : ''}
      </div>

      <!-- ===== JOB TAGS (Section 2/7) — per-job labels, separate from
           both job status above and the client's pipeline stage. ===== -->
      <div class="job-modal-field">
        <label>Tags</label>
        <div id="job-tags-list" class="job-tags-list">
          ${tags.map((t) => `<span class="job-tag-chip">${escapeHtml(t)}<button type="button" class="job-tag-remove" data-tag="${escapeHtml(t)}">&times;</button></span>`).join('')}
        </div>
        <div class="job-tag-add-row">
          <input id="job-tag-input" type="text" placeholder="Add a tag and press Enter" maxlength="40">
        </div>
        <span class="field-hint">Tags track this specific job only. They never change the client's stage.</span>
      </div>

      <!-- ===== PAYMENTS — amount paid/balance are visible to any user
           with access to this job (they need it to tell a customer their
           balance); only admins can add a payment. ===== -->
      <div class="job-modal-field">
        <div class="job-balance-row">
          <label>Payments Received</label>
          <strong>$${formatMoney(job.amount_paid)}</strong>
        </div>
        <div class="job-balance-row">
          <label>Remaining Balance</label>
          <strong>$${formatMoney(job.balance)}</strong>
        </div>
        ${admin ? `
        <div class="job-payment-row">
          <input id="job-payment-input" type="text" inputmode="decimal" placeholder="Add Payment">
          <button id="job-add-payment-btn" class="btn-primary" style="background:var(--primary);">Add Payment</button>
        </div>` : ''}
      </div>

      ${admin ? `
      <!-- ===== COST LINE ITEMS (Section 1) — description/qty/unit price
           with a required Cost Type category. Admin only. ===== -->
      <div class="job-modal-field">
        <label>Estimate / Invoice Line Items</label>
        <div id="job-line-items-list" class="job-line-items-list">
          <div class="field-hint">Loading line items...</div>
        </div>
        <div class="job-line-item-add-grid">
          <input id="li-description" type="text" placeholder="Description">
          <select id="li-category">
            ${JOB_LINE_ITEM_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input id="li-quantity" type="text" inputmode="decimal" placeholder="Qty" value="1">
          <input id="li-unit-price" type="text" inputmode="decimal" placeholder="Unit Price">
          <button id="li-add-btn" class="btn-primary" style="background:var(--primary);">Add Item</button>
        </div>
      </div>` : ''}

      <div class="job-modal-field">
        <label>Scope of Work</label>
        <textarea id="job-scope" rows="5" placeholder="Describe the work for this job...">${escapeHtml(job.scope_of_work || '')}</textarea>
      </div>

      <!-- ===== JOB NOTES — separate from the client-level notes panel ===== -->
      <div class="job-modal-field job-notes-field">
        <label>Job Notes</label>
        <div id="job-notes-list" class="notes-list"></div>
        <div class="notes-actions">
          <textarea id="job-new-note-input" placeholder="Add a note..." rows="4"></textarea>
          <button type="button" id="job-add-note-btn" class="btn-primary add-note-btn" style="background:var(--primary);">Add Note</button>
        </div>
      </div>

      <!-- ===== DOCUMENTS — contracts, estimates, invoices, reports ===== -->
      <div class="job-modal-field job-files-field">
        <label>Documents</label>
        <span class="field-hint">Contracts, estimates, invoices, reports, and other business PDFs.</span>
        <div id="job-documents-list" class="job-files-list"></div>
        <div class="job-files-upload-row">
          <input type="file" id="job-documents-input" multiple hidden accept=".pdf,.doc,.docx,.xls,.xlsx,application/pdf">
          <button type="button" id="job-documents-upload-btn" class="panel-secondary-btn">Upload Document</button>
        </div>
        <div id="job-documents-progress" class="job-file-progress" hidden>
          <div class="job-file-progress-track"><div class="job-file-progress-bar"></div></div>
          <span class="job-file-progress-label"></span>
        </div>
      </div>

      <!-- ===== PHOTOS — job/progress/site photo documentation ===== -->
      <div class="job-modal-field job-files-field">
        <label>Photos</label>
        <span class="field-hint">Job photos, progress photos, and photo documentation.</span>
        <div id="job-photos-list" class="job-files-list job-photos-grid"></div>
        <div class="job-files-upload-row">
          <input type="file" id="job-photos-input" multiple hidden accept="image/*">
          <button type="button" id="job-photos-upload-btn" class="panel-secondary-btn">Upload Photos</button>
        </div>
        <div id="job-photos-progress" class="job-file-progress" hidden>
          <div class="job-file-progress-track"><div class="job-file-progress-bar"></div></div>
          <span class="job-file-progress-label"></span>
        </div>
      </div>

      <div class="job-modal-actions">
        <button id="job-save-btn" class="btn-primary" style="background:var(--primary);">Save Job</button>
        <button id="job-estimate-btn" class="btn-primary">Download Estimate</button>
        <button id="job-invoice-btn" class="btn-primary" style="background:var(--primary);">Download Invoice</button>
        <button id="job-delete-btn" class="btn-primary" style="background:#4a5568;">Delete</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Live margin/profit update (admin only — fields don't exist for regular users)
  const totalInput = overlay.querySelector('#job-total');
  const costInput = overlay.querySelector('#job-cost');
  const marginDisplay = overlay.querySelector('#job-margin-display');
  const profitDisplay = overlay.querySelector('#job-profit-display');
  if (totalInput && costInput && marginDisplay) {
    function updateMargin() {
      const t = parseMoney(totalInput.value) || 0;
      const c = parseMoney(costInput.value) || 0;
      marginDisplay.textContent = t > 0 ? Math.round(((t - c) / t) * 100) + '%' : '—';
      if (profitDisplay) profitDisplay.textContent = '$' + formatMoney(t - c);
    }
    totalInput.addEventListener('input', updateMargin);
    costInput.addEventListener('input', updateMargin);
  }

  // Auto-save pending Job Cost / Payment entries when the panel is closed
  // without an explicit Save/Add Payment click (Section 4). Job cost is a
  // plain field update (safe to resend if unchanged — the value check below
  // just avoids a pointless call). Payment is additive, so it only fires
  // when there is a genuinely unsubmitted amount sitting in the input —
  // a successful "Add Payment" click tears down and rebuilds this whole
  // panel, so a stale already-submitted amount can never linger here.
  async function autoSaveBeforeClose() {
    if (!admin) return;
    const costEl = overlay.querySelector('#job-cost');
    if (costEl) {
      const raw = costEl.value.trim();
      if (raw) {
        const val = parseMoney(raw);
        if (Number.isFinite(val) && val >= 0 && val !== Number(job.job_cost || 0)) {
          try {
            await window.api.updateJob(job.id, { job_cost: val });
            if (onSave) await onSave();
          } catch (err) {
            console.error(err);
            showToast('Failed to save job cost', 'error');
          }
        }
      }
    }
    const paymentEl = overlay.querySelector('#job-payment-input');
    if (paymentEl) {
      const raw = paymentEl.value.trim();
      if (raw) {
        const amount = parseMoney(raw);
        if (Number.isFinite(amount) && amount > 0) {
          try {
            await window.api.addJobPayment(job.id, amount);
            if (onSave) await onSave();
          } catch (err) {
            console.error(err);
            showToast('Failed to save payment', 'error');
          }
        }
      }
    }
  }

  // Close
  overlay.querySelector('#closeJobPanel').onclick = async () => {
    await autoSaveBeforeClose();
    overlay.remove();
  };
  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) {
      await autoSaveBeforeClose();
      overlay.remove();
    }
  });

  // ===== Job tags =====
  const tagsListEl = overlay.querySelector('#job-tags-list');
  const tagInput = overlay.querySelector('#job-tag-input');
  let currentTags = tags.slice();

  function renderTags() {
    tagsListEl.innerHTML = currentTags.map((t) =>
      `<span class="job-tag-chip">${escapeHtml(t)}<button type="button" class="job-tag-remove" data-tag="${escapeHtml(t)}">&times;</button></span>`
    ).join('');
    tagsListEl.querySelectorAll('.job-tag-remove').forEach((btn) => {
      btn.onclick = () => saveTags(currentTags.filter((t) => t !== btn.dataset.tag));
    });
  }

  async function saveTags(nextTags) {
    try {
      const result = await window.api.updateJobTags(job.id, nextTags);
      currentTags = (result.job && result.job.tags) || nextTags;
      renderTags();
    } catch (err) {
      console.error(err);
      showToast('Failed to update tags', 'error');
    }
  }

  tagsListEl.querySelectorAll('.job-tag-remove').forEach((btn) => {
    btn.onclick = () => saveTags(currentTags.filter((t) => t !== btn.dataset.tag));
  });

  if (tagInput) {
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = tagInput.value.trim();
        if (value && !currentTags.includes(value)) {
          saveTags([...currentTags, value]);
        }
        tagInput.value = '';
      }
    });
  }

  // ===== Line items (admin only) =====
  const lineItemsListEl = overlay.querySelector('#job-line-items-list');
  if (admin && lineItemsListEl) {
    setupJobLineItems(overlay, job.id);
  }

  // ===== Job notes, documents, photos =====
  setupJobNotesSection(overlay, job.id);
  setupJobFilesSection(overlay, job.id, 'document');
  setupJobFilesSection(overlay, job.id, 'photo');

  // Save
  overlay.querySelector('#job-save-btn').onclick = async () => {
    const btn = overlay.querySelector('#job-save-btn');
    try {
      btn.disabled = true; btn.textContent = 'Saving...';
      const payload = {
        title: overlay.querySelector('#job-title').value.trim() || 'New Job',
        status: overlay.querySelector('#job-status').value,
        scope_of_work: overlay.querySelector('#job-scope').value
      };
      if (admin) {
        payload.total_due = parseMoney(overlay.querySelector('#job-total')?.value) || 0;
        payload.job_cost = parseMoney(overlay.querySelector('#job-cost')?.value) || 0;
      }
      await window.api.updateJob(job.id, payload);
      showToast('Job saved', 'success');
      if (onSave) await onSave();
    } catch (err) {
      console.error(err);
      showToast('Failed to save job', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Job';
    }
  };

  // Add payment (admin only — button doesn't exist otherwise)
  const addPaymentBtn = overlay.querySelector('#job-add-payment-btn');
  if (addPaymentBtn) {
    addPaymentBtn.onclick = async () => {
      const amount = parseMoney(overlay.querySelector('#job-payment-input').value);
      if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }
      try {
        const result = await window.api.addJobPayment(job.id, amount);
        overlay.remove();
        openJobPanel(result.job, clientId, onSave);
        if (onSave) await onSave();
        showToast('Payment added', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to add payment', 'error');
      }
    };
  }

  // Estimate / Invoice — available to any user with access to this job;
  // these PDFs never include job_cost/profit/margin.
  const jobEstimateBtn = overlay.querySelector('#job-estimate-btn');
  if (jobEstimateBtn) {
    jobEstimateBtn.onclick = async () => {
      try {
        jobEstimateBtn.disabled = true; jobEstimateBtn.textContent = 'Downloading...';
        await window.api.sendJobEstimate(job.id);
        showToast('Estimate downloaded', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to generate estimate', 'error');
      } finally {
        jobEstimateBtn.disabled = false; jobEstimateBtn.textContent = 'Download Estimate';
      }
    };
  }

  const jobInvoiceBtn = overlay.querySelector('#job-invoice-btn');
  if (jobInvoiceBtn) {
    jobInvoiceBtn.onclick = async () => {
      try {
        jobInvoiceBtn.disabled = true; jobInvoiceBtn.textContent = 'Downloading...';
        await window.api.sendJobInvoice(job.id);
        showToast('Invoice downloaded', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to generate invoice', 'error');
      } finally {
        jobInvoiceBtn.disabled = false; jobInvoiceBtn.textContent = 'Download Invoice';
      }
    };
  }

  // Delete
  overlay.querySelector('#job-delete-btn').onclick = async () => {
    if (!confirm('Permanently delete this job?')) return;
    try {
      await window.api.deleteJob(job.id);
      overlay.remove();
      if (onSave) await onSave();
      showToast('Job deleted', 'success');
    } catch (err) {
      showToast('Failed to delete job', 'error');
    }
  };
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
        editBtn.className = 'job-note-action-btn';
        editBtn.innerText = 'Edit';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'job-note-action-btn job-note-delete-btn';
        deleteBtn.innerText = 'Delete';

        editBtn.onclick = () => {
          const textarea = document.createElement('textarea');
          textarea.className = 'job-note-edit-textarea';
          textarea.value = note.content || '';
          textarea.rows = 4;

          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'job-note-action-btn';
          saveBtn.innerText = 'Save';

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'job-note-action-btn';
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
      loadNotes();
    } catch (err) {
      console.error(err);
      showToast('Failed to add note', 'error');
    } finally {
      addNoteBtn.disabled = false;
    }
  };

  loadNotes();
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

  uploadBtn.onclick = () => fileInput.click();

  fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (!files || !files.length) return;
    uploadBtn.disabled = true;
    setProgress(0, `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    try {
      await window.api.uploadJobFiles(jobId, category, files, (pct) => {
        setProgress(pct, `Uploading... ${pct}%`);
      });
      showToast(`${isPhoto ? 'Photo' : 'Document'}${files.length > 1 ? 's' : ''} uploaded`, 'success');
      loadFiles();
    } catch (err) {
      console.error(err);
      showToast(err.message || `Failed to upload ${isPhoto ? 'photos' : 'documents'}`, 'error');
    } finally {
      uploadBtn.disabled = false;
      fileInput.value = '';
      hideProgress();
    }
  });

  loadFiles();
}

// ======================================================
// JOB LINE ITEMS (Section 1) — admin-only cost breakdown with a
// required Cost Type category per line: Labor, Materials, Commissions,
// Meals/Drinks, Miscellaneous, Permits.
// ======================================================
async function setupJobLineItems(overlay, jobId) {
  const listEl = overlay.querySelector('#job-line-items-list');
  const addBtn = overlay.querySelector('#li-add-btn');
  const descInput = overlay.querySelector('#li-description');
  const categorySelect = overlay.querySelector('#li-category');
  const qtyInput = overlay.querySelector('#li-quantity');
  const priceInput = overlay.querySelector('#li-unit-price');
  if (!listEl || !addBtn) return;

  async function render() {
    try {
      const data = await window.api.listJobLineItems(jobId);
      const items = data.lineItems || [];
      if (items.length === 0) {
        listEl.innerHTML = '<div class="field-hint">No line items yet. Add one below.</div>';
        return;
      }
      const total = items.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      listEl.innerHTML = items.map((i) => `
        <div class="job-line-item-row" data-id="${i.id}">
          <span class="li-desc">${escapeHtml(i.description || '(no description)')}</span>
          <span class="li-category-badge">${escapeHtml(i.category)}</span>
          <span class="li-qty">${i.quantity} &times; $${formatMoney(i.unit_price)}</span>
          <span class="li-amount">$${formatMoney(i.amount)}</span>
          <button type="button" class="li-remove" data-id="${i.id}">&times;</button>
        </div>
      `).join('') + `<div class="job-line-item-total">Total: $${formatMoney(total)}</div>`;

      listEl.querySelectorAll('.li-remove').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await window.api.deleteJobLineItem(jobId, btn.dataset.id);
            await render();
          } catch (err) {
            showToast('Failed to remove line item', 'error');
          }
        };
      });
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<div class="field-hint">Failed to load line items.</div>';
    }
  }

  addBtn.onclick = async () => {
    const description = descInput.value.trim();
    const quantity = parseMoney(qtyInput.value) || 1;
    const unitPrice = parseMoney(priceInput.value) || 0;
    const category = categorySelect.value;
    try {
      addBtn.disabled = true;
      await window.api.addJobLineItem(jobId, {
        description,
        quantity,
        unit_price: unitPrice,
        category
      });
      descInput.value = '';
      qtyInput.value = '1';
      priceInput.value = '';
      await render();
      showToast('Line item added', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to add line item', 'error');
    } finally {
      addBtn.disabled = false;
    }
  };

  await render();
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
// PDF DISPLAY
// ======================================================
async function loadPDFs(clientId) {
  const container = document.getElementById("pdf-list");
  if (!container) return;

  container.innerHTML = "";
  try {
    const data = await window.api.listPDFs(clientId);
    if (!data.files || data.files.length === 0) {
      container.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">No PDFs uploaded yet.</div>`;
      return;
    }

    data.files.forEach(file => {
      const card = document.createElement("div");
      card.style.display = "flex";
      card.style.justifyContent = "space-between";
      card.style.alignItems = "center";
      card.style.background = "var(--surface, #ffffff)";
      card.style.padding = "10px 14px";
      card.style.borderRadius = "8px";
      card.style.marginBottom = "8px";
      card.style.border = "1px solid var(--border-soft, #e2e8f0)";
      card.style.boxShadow = "none";
      card.style.transition = "border-color 0.15s ease";

      card.addEventListener("mouseenter", () => {
        card.style.borderColor = "var(--border-strong, #cbd5e1)";
      });

      card.addEventListener("mouseleave", () => {
        card.style.borderColor = "var(--border-soft, #e2e8f0)";
      });

      const name = document.createElement("div");
      name.innerHTML = `<i data-lucide="file-text"></i> ${escapeHtml(file.name)}`;
      name.style.fontWeight = "600";
      name.style.fontSize = "14px";

      const btnGroup = document.createElement("div");
      btnGroup.style.display = "flex";
      btnGroup.style.gap = "6px";

      const openBtn = document.createElement("a");
      openBtn.href = file.url;
      openBtn.target = "_blank";
      openBtn.innerText = "Open";
      openBtn.style.background = "var(--primary)";
      openBtn.style.color = "white";
      openBtn.style.padding = "5px 12px";
      openBtn.style.borderRadius = "6px";
      openBtn.style.fontSize = "12px";
      openBtn.style.textDecoration = "none";

      const deleteBtn = document.createElement("button");
      deleteBtn.innerText = "Delete";
      deleteBtn.style.background = "#4a5568";
      deleteBtn.style.color = "white";
      deleteBtn.style.border = "none";
      deleteBtn.style.padding = "5px 12px";
      deleteBtn.style.borderRadius = "6px";
      deleteBtn.style.fontSize = "12px";
      deleteBtn.style.cursor = "pointer";

      deleteBtn.onclick = async () => {
        if (!confirm("Delete this PDF permanently?")) return;
        try {
          await window.api.deletePDF(clientId, file.name);
          loadPDFs(clientId);
        } catch (err) {
          console.error(err);
          showToast("Failed to delete file", "error");
        }
      };

      btnGroup.appendChild(openBtn);
      btnGroup.appendChild(deleteBtn);
      card.appendChild(name);
      card.appendChild(btnGroup);
      container.appendChild(card);
    });

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error(err);
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
// PANEL BUTTON HANDLER
// ======================================================
if (projectPanel) {
  projectPanel.addEventListener("click", async (e) => {
    const target = e.target;

    // ==============================
// UNDO FINANCIAL CHANGE
// ==============================
if (target.id === "undoFinanceBtn") {
  if (financeUndoStack.length === 0) {
    showToast("Nothing to undo", "info");
    return;
  }

  if (!confirm("Undo the last payment/total change?")) return;

  const last = financeUndoStack.pop();

  try {
    await window.api.restoreFinanceState(last.clientId, {
      total_due: last.total_due,
      amount_paid: last.amount_paid,
      balance: last.balance
    });

    await refreshList();
    await openClient(last.clientId);

    triggerFinanceUpdate();

    showToast("Undo complete", "success");
  } catch (err) {
    console.error(err);
    showToast("Undo failed", "error");
  }

  return;
}

    if (target.id === "printBtn") printClientWorkspace();

    if (target.id === "estimateBtn") {
      if (!confirm("Download this client's estimate PDF?")) return;

      try {
        target.disabled = true;
        target.textContent = "Downloading...";
        await window.api.sendEstimate(activeId);
        showToast("Estimate downloaded", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to generate estimate", "error");
      } finally {
        target.disabled = false;
        target.textContent = "Download Estimate";
      }
    }

    if (target.id === "invoiceBtn") {
      if (!confirm("Download this client's invoice PDF?")) return;

      try {
        target.disabled = true;
        target.textContent = "Downloading...";
        await window.api.sendInvoice(activeId);
        showToast("Invoice downloaded", "success");
      } catch (err) {
        console.error(err);
        showToast(err.message || "Failed to generate invoice", "error");
      } finally {
        target.disabled = false;
        target.textContent = "Download Invoice";
      }
    }

    if (target.id === "reviewBtn") {
      const googleLink = activeClient?.address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activeClient.address)}`
        : "https://www.google.com/maps/search/?api=1&query=CRM+Template";
      window.open(googleLink, "_blank");
    }

    if (target.id === "saveBtn") {
      await savePanelChanges({ silent: false, force: true });
      openClient(activeId);
    }

    if (target.id === "delBtn") {
      if (confirm("Permanently delete this client?")) {
        await window.api.deleteClient(activeId);
        await refreshList();
        closePanel();
      }
    }

    if (target.id === "closeBtn") {
      await autoSavePendingClientPayment();
      await savePanelChanges({ silent: true, force: true });
      closePanel();
    }
  });
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


function applyMoneyInputBehavior(input) {
  if (!input) return;

  const initial = input.value?.trim();
  if (initial) {
    input.value = formatMoney(parseMoney(initial));
  }

  function formatTypingValue(raw) {
    if (!raw) return "";
    const cleaned = String(raw).replace(/[^0-9.]/g, "");
    if (!cleaned) return "";

    const firstDot = cleaned.indexOf(".");
    let integerPart = cleaned;
    let decimalPart = "";
    let hasDot = false;

    if (firstDot >= 0) {
      hasDot = true;
      integerPart = cleaned.slice(0, firstDot);
      decimalPart = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    }

    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
    const displayInteger = normalizedInteger || (hasDot ? "0" : "");
    const formattedInteger = displayInteger
      ? Number(displayInteger).toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "";

    if (hasDot) return `${formattedInteger}.${decimalPart}`;
    return formattedInteger;
  }

  function caretPosFromDigitCount(value, digitCount) {
    if (digitCount <= 0) return 0;
    let count = 0;
    for (let i = 0; i < value.length; i++) {
      if (/\d/.test(value[i])) count++;
      if (count === digitCount) return i + 1;
    }
    return value.length;
  }

  input.addEventListener("input", () => {
    const selectionStart = input.selectionStart ?? input.value.length;
    const beforeCursor = input.value.slice(0, selectionStart);
    const digitsBefore = (beforeCursor.match(/\d/g) || []).length;

    const formatted = formatTypingValue(input.value);
    input.value = formatted;

    const nextPos = caretPosFromDigitCount(formatted, digitsBefore);
    input.setSelectionRange(nextPos, nextPos);
  });

  input.addEventListener("blur", () => {
    const raw = input.value.trim();
    if (!raw) return;
    input.value = formatMoney(parseMoney(raw));
  });
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

function collectPanelData() {
  const jobCostRaw = document.getElementById("jobCostInput")?.value || "0";
  const jobCost = parseMoney(jobCostRaw) || 0;
  return {
    id: activeId,
    name: getStoredClientName(),
    address: document.getElementById("p-address")?.value || "",
    status: document.getElementById("p-status")?.value || "",
    phone: document.getElementById("p-phone")?.value || "",
    email: document.getElementById("p-email")?.value || "",
    scope_of_work: document.getElementById("p-scope")?.value || "",
    job_cost: jobCost
  };
}

async function savePanelChanges({ silent = false, force = false } = {}) {
  if (!activeId) return;
  if (isSaving) {
    queuedSave = true;
    return;
  }

  isSaving = true;
  setSaveStatus("saving");
  try {
    await savePendingNotes({ silent: true });

    const data = collectPanelData();
    if (!force && !data) return;

    await window.api.updateProject(data);
    await refreshList();
    await setupNotesSection(activeId);
    setSaveStatus("saved");
    if (!silent) {
      showToast("Saved", "success");
    }
  } catch (err) {
    console.error(err);
    setSaveStatus("error");
    if (!silent) showToast("Save failed", "error");
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
    const typeBadge = e.target.closest(".client-type-badge");
    if (typeBadge && typeBadge.dataset.filterType) {
      e.stopPropagation();
      searchByTagClick(typeBadge.textContent.trim());
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

  if (e.key === "Escape" && projectPanel && projectPanel.style.display === "block") {
    await savePanelChanges({ silent: true, force: true });
    closePanel();
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
    initAdvancedFiltering();
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

  // Apply brand colors as CSS variables
  if (branding.primaryColor) {
    document.documentElement.style.setProperty('--primary', branding.primaryColor);
    document.documentElement.style.setProperty('--brand-primary', branding.primaryColor);
  }
  if (branding.secondaryColor) {
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
