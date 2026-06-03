const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { buildTransportOptions, formatFromAddress, normalizeEmailConfig } = require('./email-config');
const { normalizeCompanyProfile } = require('./company-profile');

const STATUS_VALUES = ['Prospect', 'Approved', 'Completed', 'Invoice', 'Closed', 'Lead'];

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function safeText(value, fallback = '') {
  const s = value === null || value === undefined ? '' : String(value).trim();
  return s || fallback;
}

// Strip any status values that may have been accidentally saved into the address field
function sanitizeAddress(value) {
  const s = safeText(value);
  return s.split(/\r?\n/)
    .filter(line => !STATUS_VALUES.includes(line.trim()))
    .join('\n')
    .trim();
}

function resolveLogoBuffer(data) {
  if (!data.logoBase64) return null;
  try {
    const raw = String(data.logoBase64).trim();
    const match = raw.match(/^data:image\/[^;]+;base64,(.+)$/);
    const b64 = match ? match[1] : raw;
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

function normalizeWorkLines(workDescription) {
  const lines = String(workDescription || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[•\-*]\s*/, ''));
  return lines.length ? lines : ['No scope of work provided.'];
}

function drawRule(doc, x, y, width, color) {
  doc.moveTo(x, y).lineTo(x + width, y)
    .lineWidth(0.5).strokeColor(color || '#d1d5db').stroke();
}

function drawSummaryRow(doc, label, value, x, y, contentWidth, bold) {
  const labelW = contentWidth * 0.65;
  const valueX = x + labelW;
  const valueW = contentWidth * 0.35;
  const fs = bold ? 12 : 10;
  const color = bold ? '#111827' : '#374151';

  if (bold) {
    doc.rect(x - 4, y - 4, contentWidth + 8, 24)
      .fillColor('#f1f5f9').fill();
  }

  doc.fontSize(fs).fillColor(color)
    .text(label, x, y, { width: labelW });
  doc.fontSize(fs).fillColor(color)
    .text(`$${formatMoney(value)}`, valueX, y, { width: valueW, align: 'right' });

  return y + (bold ? 28 : 22);
}

// ======================================================
// GENERATE INVOICE OR ESTIMATE PDF
// ======================================================
function generateInvoicePDF(data, mode) {
  mode = mode || 'invoice';
  return new Promise(function(resolve, reject) {
    const doc = new PDFDocument({ margin: 52, size: 'LETTER' });
    const buffers = [];
    doc.on('data', function(chunk) { buffers.push(chunk); });
    doc.on('end', function() { resolve(Buffer.concat(buffers)); });
    doc.on('error', reject);

    const isEstimate = mode === 'estimate';
    const docTitle = isEstimate ? 'ESTIMATE' : 'INVOICE';
    const M = doc.page.margins.left;
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - M * 2;
    const pageBottom = doc.page.height - doc.page.margins.bottom - 20;

    // ---- Logo ----
    const logoBuffer = resolveLogoBuffer(data);
    let startY = M;

    if (logoBuffer) {
      try {
        const logoW = 140;
        const logoX = (pageWidth - logoW) / 2;
        doc.image(logoBuffer, logoX, startY, { fit: [logoW, 80] });
        startY += 96;
      } catch (e) {
        // skip
      }
    }

    // ---- Header: company left, doc title right ----
    const leftW = contentWidth * 0.55;
    const rightW = contentWidth * 0.42;
    const rightX = M + contentWidth - rightW;

    doc.fontSize(16).fillColor('#111827')
      .text(safeText(data.businessName, 'Your Company'), M, startY, { width: leftW });

    let companyY = startY + 22;
    [safeText(data.businessAddress), safeText(data.businessPhone), safeText(data.businessEmail)]
      .filter(Boolean)
      .forEach(function(line) {
        doc.fontSize(9).fillColor('#4b5563').text(line, M, companyY, { width: leftW });
        companyY += 13;
      });

    doc.fontSize(24).fillColor('#111827')
      .text(docTitle, rightX, startY, { width: rightW, align: 'right' });
    doc.fontSize(9).fillColor('#6b7280')
      .text(docTitle + ' #: ' + safeText(data.invoiceNumber), rightX, startY + 32, { width: rightW, align: 'right' });
    doc.fontSize(9).fillColor('#6b7280')
      .text('Date: ' + safeText(data.date), rightX, startY + 46, { width: rightW, align: 'right' });

    let cursorY = Math.max(companyY, startY + 62) + 16;

    // ---- Divider ----
    drawRule(doc, M, cursorY, contentWidth);
    cursorY += 16;

    // ---- Bill To ----
    doc.fontSize(8).fillColor('#9ca3af').text('BILL TO', M, cursorY, { width: contentWidth });
    cursorY += 14;

    doc.fontSize(11).fillColor('#111827').text(safeText(data.clientName, '—'), M, cursorY, { width: contentWidth });
    cursorY += doc.heightOfString(safeText(data.clientName, '—'), { width: contentWidth }) + 4;

    [sanitizeAddress(data.clientAddress), safeText(data.clientPhone), safeText(data.clientEmail)]
      .filter(Boolean)
      .forEach(function(line) {
        doc.fontSize(9).fillColor('#4b5563').text(line, M, cursorY, { width: contentWidth });
        cursorY += 13;
      });

    cursorY += 16;

    // ---- Divider ----
    drawRule(doc, M, cursorY, contentWidth);
    cursorY += 16;

    // ---- Scope of Work ----
    const workHeading = isEstimate ? 'SCOPE OF WORK' : 'WORK COMPLETED';
    doc.fontSize(8).fillColor('#9ca3af').text(workHeading, M, cursorY, { width: contentWidth });
    cursorY += 14;

    normalizeWorkLines(data.workDescription).forEach(function(line) {
      const lineText = '\u2022  ' + line;
      const lineH = doc.heightOfString(lineText, { width: contentWidth - 12, lineGap: 2 });
      if (cursorY + lineH > pageBottom) {
        doc.addPage();
        cursorY = doc.page.margins.top;
      }
      doc.fontSize(10).fillColor('#374151')
        .text(lineText, M + 4, cursorY, { width: contentWidth - 12, lineGap: 2 });
      cursorY += lineH + 4;
    });

    cursorY += 16;

    // ---- Divider ----
    if (cursorY + 20 > pageBottom) { doc.addPage(); cursorY = doc.page.margins.top; }
    drawRule(doc, M, cursorY, contentWidth);
    cursorY += 16;

    // ---- Summary ----
    const summaryTotal = Number(data.total || 0);
    const summaryPaid = Number(data.paid || 0);
    const summaryBalance = Number(data.balance || 0);

    if (isEstimate) {
      doc.fontSize(8).fillColor('#9ca3af').text('ESTIMATE TOTAL', M, cursorY, { width: contentWidth });
      cursorY += 14;
      doc.fontSize(26).fillColor('#111827').text('$' + formatMoney(summaryTotal), M, cursorY, { width: contentWidth });
      cursorY += 38;
      doc.fontSize(8).fillColor('#9ca3af')
        .text('This estimate is valid for 30 days. Prices subject to change based on final inspection.', M, cursorY, { width: contentWidth });
      cursorY += 20;

      if (cursorY + 80 > pageBottom) { doc.addPage(); cursorY = doc.page.margins.top; }
      drawRule(doc, M, cursorY, contentWidth);
      cursorY += 16;

      doc.fontSize(8).fillColor('#9ca3af').text('TERMS & ACCEPTANCE', M, cursorY, { width: contentWidth });
      cursorY += 14;
      doc.fontSize(9).fillColor('#374151')
        .text('By signing below, you authorize the work described above at the stated price.', M, cursorY, { width: contentWidth });
      cursorY += 28;

      if (cursorY + 30 > pageBottom) { doc.addPage(); cursorY = doc.page.margins.top; }
      doc.moveTo(M, cursorY).lineTo(M + 220, cursorY).lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.fontSize(8).fillColor('#888888').text('Customer Signature', M, cursorY + 5, { width: 220 });
      doc.moveTo(M + 260, cursorY).lineTo(M + 380, cursorY).lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.fontSize(8).fillColor('#888888').text('Date', M + 260, cursorY + 5, { width: 120 });
      cursorY += 30;

    } else {
      doc.fontSize(8).fillColor('#9ca3af').text('INVOICE SUMMARY', M, cursorY, { width: contentWidth });
      cursorY += 14;
      if (cursorY + 80 > pageBottom) { doc.addPage(); cursorY = doc.page.margins.top; }
      cursorY = drawSummaryRow(doc, 'Contract Price', summaryTotal, M, cursorY, contentWidth, false);
      cursorY = drawSummaryRow(doc, 'Amount Paid', summaryPaid, M, cursorY, contentWidth, false);
      cursorY = drawSummaryRow(doc, 'Balance Due', summaryBalance, M, cursorY, contentWidth, true);
      cursorY += 8;
    }

    // ---- Closing ----
    if (cursorY + 30 > pageBottom) { doc.addPage(); cursorY = doc.page.margins.top; }
    drawRule(doc, M, cursorY, contentWidth);
    cursorY += 14;
    doc.fontSize(9).fillColor('#9ca3af')
      .text(isEstimate ? 'Thank you for considering us!' : 'Thank you for your business!',
        M, cursorY, { width: contentWidth, align: 'center' });

    doc.end();
  });
}

async function sendInvoiceEmail(to, pdfBuffer, emailConfig, mode) {
  emailConfig = emailConfig || {};
  mode = mode || 'invoice';
  const normalized = normalizeEmailConfig(emailConfig);
  const transportOptions = buildTransportOptions(normalized);
  const transporter = nodemailer.createTransport(transportOptions);
  const isEstimate = mode === 'estimate';

  await transporter.sendMail({
    from: formatFromAddress(normalized) || normalized.smtpUser,
    replyTo: normalized.replyToEmail || normalized.fromEmail || normalized.smtpUser || undefined,
    to,
    subject: isEstimate ? 'Your Estimate' : 'Your Invoice',
    text: isEstimate
      ? 'Attached is your estimate. Thank you for considering us.'
      : 'Attached is your invoice. Thank you for your business.',
    attachments: [
      { filename: isEstimate ? 'estimate.pdf' : 'invoice.pdf', content: pdfBuffer }
    ]
  });
}

function buildInvoiceData(opts) {
  const client = opts.client;
  const companyProfile = opts.companyProfile || {};
  const mode = opts.mode || 'invoice';

  const workDescription = client.scope_of_work || 'No scope of work provided.';
  const company = normalizeCompanyProfile(companyProfile, process.env);
  const isEstimate = mode === 'estimate';
  const prefix = isEstimate ? 'EST' : 'INV';

  return {
    businessName: company.businessName,
    businessAddress: company.businessAddress,
    businessPhone: company.businessPhone,
    businessEmail: company.businessEmail,
    logoBase64: companyProfile.logoBase64 || company.logoBase64 || null,
    date: new Date().toLocaleDateString(),
    invoiceNumber: prefix + '-' + client.id + '-' + Date.now(),
    clientName: client.name || '',
    clientAddress: sanitizeAddress(client.address),
    clientPhone: client.phone || '',
    clientEmail: client.email || '',
    workDescription: workDescription,
    total: client.total != null ? client.total : (client.total_due != null ? client.total_due : 0),
    paid: client.paid != null ? client.paid : (client.amount_paid != null ? client.amount_paid : 0),
    balance: client.balance != null ? client.balance : 0
  };
}

module.exports = {
  buildInvoiceData,
  generateInvoicePDF,
  sendInvoiceEmail
};
