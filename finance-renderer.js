// ====================================================== 
// FINANCE PAGE RENDERER (Stable + Live Updates from Payments & Clients)
// ======================================================
//
// CHART LIFECYCLE MANAGEMENT:
// Before rendering any chart into a canvas element, this module
// checks for a pre-existing Chart.js instance on that canvas and
// calls chartInstance.destroy() to prevent rendering glitches when
// users dynamically edit expenses or add payment overrides.
//
// REVENUE RECONCILIATION:
// Manual revenue overrides (finance_overrides.total_expected) and
// raw client payment rows are aggregated into a single 'Total Revenue'
// metric.  If overrides exist, they take precedence; otherwise the
// sum of all payments for the year is used.

const taxGroups = ["w9", "pnl", "1099", "inference"];
const financeTableBody = document.getElementById("metricsBody");
const yearSelector = document.getElementById("finance-year");

let activeYear = new Date().getFullYear();
let financeUndoStack = [];
let _chartInstances = {};  // Track Chart.js instances by canvas id

// ============================================================
// DESTROY_CHART(canvasId)
// Checks for a pre-existing Chart.js or canvas chart context
// and explicitly destroys it before rendering new data.
// ============================================================
function destroyChart(canvasId) {
  var instance = _chartInstances[canvasId];
  if (instance) {
    try {
      instance.destroy();
    } catch (_) {}
    delete _chartInstances[canvasId];
  }
  var canvas = document.getElementById(canvasId);
  if (canvas) {
    var ctx = canvas.getContext('2d');
    if (ctx) {
      // Clear the canvas completely
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

// ============================================================
// REGISTER_CHART(canvasId, chartInstance)
// Stores a reference so it can be destroyed later.
// ============================================================
function registerChart(canvasId, chartInstance) {
  destroyChart(canvasId);
  _chartInstances[canvasId] = chartInstance;
}

function formatCurrencyValue(value) {
  var num = Number(value) || 0;
  if (!Number.isFinite(num)) return "0.00";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCurrencyValue(value) {
  if (value === null || value === undefined) return 0;
  var cleaned = String(value).replace(/[^0-9.-]/g, "");
  var num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

// Natural typing (no reformatting while typing); formatted on blur —
// see public/js/money-input.js.
function applyCurrencyInputBehavior(input) {
  if (!input || !window.crmMoney) return;
  window.crmMoney.attach(input);
}

// ======================================================
// LOAD AVAILABLE YEARS (AUTO DROPDOWN)
// ======================================================
async function loadAvailableYears() {
  if (!yearSelector) return;

  try {
    const res = await fetch("/api/finance/years");
    if (!res.ok) throw new Error("Failed to fetch years");

    const years = await res.json();

    yearSelector.innerHTML = "";

    years.forEach((year) => {
      const option = document.createElement("option");
      option.value = year;
      option.textContent = year;
      yearSelector.appendChild(option);
    });

    const newestYear = years[0] || new Date().getFullYear();
    activeYear = parseInt(newestYear);
    yearSelector.value = activeYear;

  } catch (err) {
    console.error("Year dropdown error:", err);
    yearSelector.innerHTML = `<option value="${activeYear}">${activeYear}</option>`;
  }
}

// ======================================================
// SAFE ELEMENT FINDER
// ======================================================
function findGroupContainer(group) {
  return document.querySelector(
    `[id*="${group}"][id*="group"], [data-group="${group}"]`
  );
}

function findListContainer(group) {
  return document.querySelector(
    `[id*="${group}"][id*="list"], [data-list="${group}"]`
  );
}

// ======================================================
// FETCH FINANCE SUMMARY
// Returns aggregate data for the given year including:
//   - totalExpected: from finance_overrides (manual override)
//   - totalReceived: from finance_overrides (manual override)
//   - totalRemaining: calculated
//   - paymentTotal: raw sum of all payments for the year
//   - totalClients: distinct client count with payments
//   - avgMarginPct: average margin percentage
//
// The totalExpected from manual overrides is reconciled
// against the raw payment total for the 'Total Revenue' view.
// ======================================================
async function fetchFinanceSummary(year) {
  try {
    var res = await fetch('/api/finance/summary?year=' + year);
    if (!res.ok) throw new Error('Failed to fetch summary');
    var data = await res.json();
    // Ensure every field has a fallback zero
    return {
      totalExpected: data && data.totalExpected ? data.totalExpected : 0,
      totalReceived: data && data.totalReceived ? data.totalReceived : 0,
      totalRemaining: data && data.totalRemaining ? data.totalRemaining : 0,
      totalClients: data && data.totalClients ? data.totalClients : 0,
      // Whether an admin has a persistent override saved for the year (the
      // Year Totals table then shows the saved figures, not the calculated ones).
      hasOverride: data && data.hasOverride === true,
      totalPaymentSum: data && data.totalPaymentSum ? data.totalPaymentSum : 0,
      avgMarginPct: data && data.avgMarginPct !== null && data.avgMarginPct !== undefined ? data.avgMarginPct : null,
      oneOffRevenue: data && data.oneOffRevenue ? data.oneOffRevenue : 0,
      recurringRevenue: data && data.recurringRevenue ? data.recurringRevenue : 0
    };
  } catch (err) {
    console.error('Finance summary error:', err);
    return null;
  }
}

// ======================================================
// UPDATE METRICS (Editable Version)
// ======================================================
async function updateFinanceMetrics() {
  if (!financeTableBody) return;

  try {
    var summary = await fetchFinanceSummary(activeYear);

    // The summary already applies a persistent manual override when one is
    // saved (or falls back to the calculated/stored figures otherwise), so show
    // its value directly. A saved override of exactly 0 is displayed as 0.
    var expected = summary ? summary.totalExpected : 0;
    var received = summary ? summary.totalReceived : 0;
    var remaining = summary ? summary.totalRemaining : 0;
    var clients = summary ? summary.totalClients : 0;
    var avgMargin = summary ? summary.avgMarginPct : null;
    var oneOff = summary ? summary.oneOffRevenue : 0;
    var recurring = summary ? summary.recurringRevenue : 0;

    var avgMarginDisplay = avgMargin !== null && avgMargin !== undefined
      ? avgMargin + '%'
      : '—';

    financeTableBody.innerHTML = [
      '<tr class="metrics-values-row">',
      '<td data-label="Year">' + activeYear + '</td>',
      '<td data-label="Expected Earnings"><input type="text" id="input-expected" inputmode="decimal" value="' + formatCurrencyValue(expected) + '" /></td>',
      '<td data-label="Received"><input type="text" id="input-received" inputmode="decimal" value="' + formatCurrencyValue(received) + '" /></td>',
      '<td data-label="Remaining"><input type="text" id="input-remaining" inputmode="decimal" value="' + formatCurrencyValue(remaining) + '" /></td>',
      '<td data-label="Clients"><input type="number" id="input-clients" inputmode="numeric" enterkeyhint="done" pattern="[0-9]*" step="1" value="' + clients + '" /></td>',
      '<td data-label="Avg Margin" style="font-weight:700; color:' + (avgMargin !== null && avgMargin !== undefined ? (avgMargin >= 30 ? 'var(--success-text)' : avgMargin >= 15 ? 'var(--warning-text)' : 'var(--danger-text)') : 'var(--text-muted)') + ';">' + avgMarginDisplay + '</td>',
      '</tr>',
      '<tr class="metrics-actions-row">',
      '<td colspan="6" class="metrics-actions-cell" style="text-align:right;">',
      (summary && summary.hasOverride ? '<span style="float:left; line-height:34px; color:var(--warning-text); font-weight:600; font-size:13px;"><span class="fo-badge">Manual override</span> saved — the cards show your figures; the records may differ.</span>' : ''),
      '<button id="saveFinanceBtn" style="background:var(--primary); color:white; border:none; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600;">Save Year Data</button>',
      '<button id="undoFinanceYearBtn" style="margin-left:10px; background:var(--surface); color:var(--text-main); border:1px solid var(--border-strong); padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600;">Undo</button>',
      '<button id="clearOverrideBtn" style="margin-left:10px; background:var(--surface); color:var(--text-main); border:1px solid var(--border-strong); padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600;">Clear override</button>',
      '</td>',
      '</tr>'
    ].join('');

    document.getElementById('saveFinanceBtn').addEventListener('click', saveFinanceYear);
    document.getElementById('undoFinanceYearBtn').addEventListener('click', undoFinanceYear);
    document.getElementById('clearOverrideBtn').addEventListener('click', clearFinanceOverride);

    ['input-expected', 'input-received', 'input-remaining'].forEach(function (id) {
      var input = document.getElementById(id);
      applyCurrencyInputBehavior(input);
    });

  } catch (err) {
    console.error('Metrics error:', err);
  }
}

// ======================================================
// SAVE MANUAL YEAR DATA
// ======================================================
async function saveFinanceYear() {
  var previousSummary = await fetchFinanceSummary(activeYear);

  financeUndoStack.push({
    year: activeYear,
    // Remember whether an override was active, so Undo can restore that state
    // (including clearing it when the previous state had no override).
    hadOverride: previousSummary ? previousSummary.hasOverride === true : false,
    totalExpected: previousSummary ? previousSummary.totalExpected : 0,
    totalReceived: previousSummary ? previousSummary.totalReceived : 0,
    totalRemaining: previousSummary ? previousSummary.totalRemaining : 0,
    totalClients: previousSummary ? previousSummary.totalClients : 0
  });

  var data = {
    year: activeYear,
    totalExpected: parseCurrencyValue((document.getElementById('input-expected') || {}).value),
    totalReceived: parseCurrencyValue((document.getElementById('input-received') || {}).value),
    totalRemaining: parseCurrencyValue((document.getElementById('input-remaining') || {}).value),
    totalClients: Number((document.getElementById('input-clients') || {}).value) || 0,
  };

  try {
    var res = await fetch('/api/finance/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) throw new Error('Save failed');

    alert('Finance data saved successfully.');
    document.dispatchEvent(new Event('financeUpdated'));

  } catch (err) {
    console.error('Save error:', err);
    alert('Error saving finance data.');
  }
}

// Removes the persistent manual override for the year, so the Year Totals
// table and the KPI cards return to the figures the records add up to.
async function clearFinanceOverride() {
  if (!confirm('Clear the saved override for ' + activeYear + ' and show the calculated figures again?')) return;

  try {
    var res = await fetch('/api/finance/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year: activeYear, clear: true })
    });

    if (!res.ok) throw new Error('Clear failed');

    alert('Override cleared. Showing the calculated figures.');
    document.dispatchEvent(new Event('financeUpdated'));
  } catch (err) {
    console.error('Clear override error:', err);
    alert('Error clearing the override.');
  }
}

async function undoFinanceYear() {
  if (financeUndoStack.length === 0) {
    alert('Nothing to undo.');
    return;
  }

  var lastState = financeUndoStack.pop();

  // Restore the previous state faithfully: re-save the values when an override
  // was active, or clear it when there was none (so Undo never invents one).
  var undoBody = lastState.hadOverride
    ? { year: lastState.year, totalExpected: lastState.totalExpected, totalReceived: lastState.totalReceived, totalRemaining: lastState.totalRemaining, totalClients: lastState.totalClients }
    : { year: lastState.year, clear: true };

  try {
    var res = await fetch('/api/finance/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(undoBody),
    });

    if (!res.ok) throw new Error('Undo failed');

    alert('Finance year restored.');
    document.dispatchEvent(new Event('financeUpdated'));

  } catch (err) {
    console.error('Undo error:', err);
    alert('Error restoring finance data.');
  }
}

// ======================================================
// YEAR SELECTOR
// ======================================================
if (yearSelector) {
  yearSelector.addEventListener("change", (e) => {
    activeYear = parseInt(e.target.value) || new Date().getFullYear();
    updateFinanceMetrics();
    taxGroups.forEach((group) => loadPDFs(group));
  });
}

// ======================================================
// ADD UPLOAD BUTTONS (Styled)
// ======================================================
function addUploadButtons() {
  taxGroups.forEach((group) => {
    const container = findGroupContainer(group);
    if (!container) return;

    if (container.querySelector(`[data-upload="${group}"]`)) return;

    const btn = document.createElement("button");
    btn.innerText = "Upload PDF";
    btn.type = "button";
    btn.setAttribute("data-upload", group);

    btn.style.marginTop = "10px";
    btn.style.background = "var(--primary)";
    btn.style.color = "#fff";
    btn.style.border = "none";
    btn.style.padding = "8px 14px";
    btn.style.borderRadius = "6px";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "600";
    btn.style.boxShadow = "none";

    btn.onclick = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,application/pdf";
      input.multiple = true;
      input.style.position = "fixed";
      input.style.left = "-9999px";
      input.style.top = "0";
      input.setAttribute("aria-hidden", "true");
      let cleanedUp = false;

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        input.remove();
        window.removeEventListener("focus", handleWindowFocus);
      };

      const handleWindowFocus = () => {
        // If the dialog was dismissed without choosing a file, remove the temp input.
        if (!input.files || input.files.length === 0) cleanup();
      };

      input.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        const originalText = btn.textContent;
        btn.textContent = "Uploading...";
        btn.disabled = true;

        try {
          await uploadPDFsWithFallback(files, `${group}-${activeYear}`);
          loadPDFs(group);

          // Update metrics after PDF upload
          document.dispatchEvent(new Event("financeUpdated"));
        } finally {
          cleanup();
          btn.textContent = originalText;
          btn.disabled = false;
        }
      });

      document.body.appendChild(input);
      window.addEventListener("focus", handleWindowFocus, { once: true });
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
          return;
        } catch (err) {
          // Fall through to click for browsers that disallow showPicker on hidden inputs.
        }
      }

      input.click();
    };

    container.appendChild(btn);
  });
}

// ======================================================
// UPLOAD
// ======================================================
// Files always go through the server, which checks access and stores them in
// the private bucket with the server-side key (no direct browser upload with
// the public key).
async function uploadPDFsWithFallback(files, groupKey) {
  return uploadPDFs(files, groupKey);
}

async function uploadPDFs(files, groupKey) {
  const formData = new FormData();
  files.forEach(file => formData.append("files", file));

  const res = await fetch(`/api/pdf/upload/${groupKey}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Upload failed${detail ? `: ${detail}` : ""}`);
  }

  return await res.json();
}

// ======================================================
// LOAD PDFs
// ======================================================
async function loadPDFs(group) {
  const container = findListContainer(group);
  if (!container) return;

  container.innerHTML = "";

  try {
    const res = await fetch(`/api/pdf/list/${group}-${activeYear}`);
    if (!res.ok) throw new Error("List failed");

    const data = await res.json();

    if (!data.files || data.files.length === 0) {
      container.innerHTML =
        `<div style="color:var(--text-muted);font-size:13px;">No PDFs uploaded.</div>`;
      return;
    }

    const isMobile = window.innerWidth <= 768;

    data.files.forEach((file) => {
      const card = document.createElement("div");
      card.style.display = "inline-flex";
      card.style.flexDirection = "column";
      card.style.alignItems = "center";
      card.style.margin = "12px";
      card.style.padding = "10px";
      card.style.background = "var(--surface)";
      card.style.borderRadius = "8px";
      card.style.border = "1px solid var(--border-soft)";

      if (!isMobile) {
        const thumb = document.createElement("embed");
        thumb.src = file.url;
        thumb.type = "application/pdf";
        thumb.width = "100";
        thumb.height = "120";
        thumb.style.borderRadius = "6px";
        card.appendChild(thumb);
      }

      const name = document.createElement("div");
      name.innerText = file.name;
      name.style.fontSize = "12px";
      name.style.marginTop = isMobile ? "2px" : "6px";
      name.style.textAlign = "center";
      name.style.color = "#1a202c";
      card.appendChild(name);

      const viewBtn = document.createElement("button");
      viewBtn.innerText = "View";
      viewBtn.style.marginTop = "8px";
      viewBtn.style.background = "var(--primary)";
      viewBtn.style.color = "#fff";
      viewBtn.style.border = "none";
      viewBtn.style.padding = "6px 12px";
      viewBtn.style.borderRadius = "5px";
      viewBtn.style.cursor = "pointer";
      viewBtn.style.fontWeight = "600";
      viewBtn.onclick = () => openPDFModal(file.url);
      card.appendChild(viewBtn);

      const delBtn = document.createElement("button");
      delBtn.innerText = "Delete";
      delBtn.style.marginTop = "6px";
      delBtn.style.background = "#4a5568";
      delBtn.style.color = "#fff";
      delBtn.style.border = "none";
      delBtn.style.padding = "6px 12px";
      delBtn.style.borderRadius = "5px";
      delBtn.style.cursor = "pointer";
      delBtn.style.fontWeight = "600";

      delBtn.onclick = async () => {
        if (!confirm(`Delete ${file.name}?`)) return;

        await fetch(
          `/api/pdf/delete/${group}-${activeYear}?file=${encodeURIComponent(file.name)}`,
          { method: "DELETE" }
        );

        loadPDFs(group);
        document.dispatchEvent(new Event("financeUpdated"));
      };

      card.appendChild(delBtn);
      container.appendChild(card);
    });
  } catch (err) {
    console.error("Load PDFs error:", err);
  }
}

// ======================================================
// RESPONSIVE MODAL VIEWER
// ======================================================
function openPDFModal(url) {
  const modal = document.getElementById("pdfModal");
  const viewer = document.getElementById("pdfViewer");
  if (!modal || !viewer) return;

  viewer.innerHTML = "";

  const embed = document.createElement("embed");
  embed.src = url;
  embed.type = "application/pdf";
  embed.style.width = "100%";
  embed.style.height = "90vh";
  embed.style.border = "none";

  viewer.appendChild(embed);
  modal.style.display = "flex";
}

// ======================================================
// MODAL CLOSE
// ======================================================
{
  const modal = document.getElementById("pdfModal");
  const closeBtn = document.getElementById("pdfModalClose");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
      document.getElementById("pdfViewer").innerHTML = "";
    });
  }

  document.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      document.getElementById("pdfViewer").innerHTML = "";
    }
  });
}

// ======================================================
// LISTEN FOR FINANCE UPDATES (Live from Payments, PDFs, Manual Saves, Client Updates)
// ======================================================
document.addEventListener("financeUpdated", () => {
  updateFinanceMetrics();
  taxGroups.forEach((group) => loadPDFs(group));
});

// ======================================================
// AUTO REFRESH METRICS WHEN CLIENT DATA CHANGES
// ======================================================
function refreshFinanceMetrics() {
  document.dispatchEvent(new Event("financeUpdated"));
}

// ======================================================
// INIT
// ======================================================
(async function initFinancePage() {
  await loadAvailableYears();
  await updateFinanceMetrics();
  taxGroups.forEach((group) => loadPDFs(group));
  addUploadButtons();
})();
