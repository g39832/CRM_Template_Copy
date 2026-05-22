const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { buildTransportOptions, formatFromAddress, normalizeEmailConfig } = require('./email-config');
const { normalizeCompanyProfile } = require('./company-profile');

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function safeText(value, fallback = '') {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || fallback;
}

// Extract base64 from a data URL or raw base64 string — never falls back to disk
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
  const rawLines = String(workDescription || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rawLines.length === 0) return ['No scope of work provided.'];
  return rawLines.map((line) => line.replace(/^[•\-*]\s*/, ''));
}

// ======================================================
// GENERATE INVOICE OR ESTIMATE PDF
// mode: 'invoice' | 'estimate'
// ======================================================
function generateInvoicePDF(data, mode = 'invoice') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 52, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const isEstimate = mode === 'estimate';
    const docTitle = isEstimate ? 'ESTIMATE' : 'INVOICE';
    const M = doc.page.margins.left;           // left margin (52)
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - M * 2;    // usable width

    // ---- Logo ----
    const logoBuffer = resolveLogoBuffer(data);
    const centerX = pageWidth / 2;

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, centerX - 80, 52, { fit: [160, 100] });
        doc.y = 168;
      } catch {
        doc.y = 52;
      }
    } else {
      doc.y = 52;
    }

    // ---- Company info (left) + Document title (right) ----
    const headerY = doc.y;
    doc.fontSize(18).fillColor('#111827')
      .text(safeText(data.businessName, 'Your Company'), M, headerY, { width: contentWidth * 0.55 });

    doc.fontSize(10).fillColor('#4b5563')
      .text(safeText(data.businessAddress), M, headerY + 26, { width: contentWidth * 0.55 })
      .text(safeText(data.businessPhone), M, headerY + 40, { width: contentWidth * 0.55 })
      .text(safeText(data.businessEmail), M, headerY + 54, { width: contentWidth * 0.55 });

    // Right column: title + number + date
    const rightX = M + contentWidth * 0.6;
    const rightW = contentWidth * 0.4;
    doc.fontSize(22).fillColor('#111827')
      .text(docTitle, rightX, headerY, { width: rightW, align: 'right' });
    doc.fontSize(10).fillColor('#4b5563')
      .text(`${docTitle} #: ${safeText(data.invoiceNumber)}`, rightX, headerY + 30, { width: rightW, align: 'right' })
      .text(`Date: ${safeText(data.date)}`, rightX, headerY + 44, { width: rightW, align: 'right' });

    // ---- Divider ----
    const divY = headerY + 76;
    doc.moveTo(M, divY).lineTo(M + contentWidth, divY)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke();

    // ---- Customer info ----
    let cursorY = divY + 16;
    doc.fontSize(11).fillColor('#6b7280')
      .text('BILL TO', M, cursorY, { width: contentWidth });
    cursorY += 16;
    doc.fontSize(11).fillColor('#111827')
      .text(safeText(data.clientName), M, cursorY, { width: contentWidth });
    cursorY += 14;
    doc.fontSize(10).fillColor('#4b5563')
      .text(safeText(data.clientAddress), M, cursorY, { width: contentWidth });
    cursorY += 14;
    doc.fontSize(10).fillColor('#4b5563')
      .text(safeText(data.clientPhone), M, cursorY, { width: contentWidth });
    cursorY += 14;
    doc.fontSize(10).fillColor('#4b5563')
      .text(safeText(data.clientEmail), M, cursorY, { width: contentWidth });
    cursorY += 24;

    // ---- Divider ----
    doc.moveTo(M, cursorY).lineTo(M + contentWidth, cursorY)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke();
    cursorY += 16;

    // ---- Scope of Work ----
    const workHeading = isEstimate ? 'SCOPE OF WORK' : 'WORK COMPLETED';
    doc.fontSize(10).fillColor('#6b7280')
      .text(workHeading, M, cursorY, { width: contentWidth });
    cursorY += 16;

    const workLines = normalizeWorkLines(data.workDescription);
    workLines.forEach((line) => {
      doc.fontSize(10).fillColor('#374151')
        .text(`• ${line}`, M + 8, cursorY, { width: contentWidth - 8, lineGap: 2 });
      cursorY += doc.heightOfString(`• ${line}`, { width: contentWidth - 8, lineGap: 2 }) + 4;
    });
    cursorY += 16;

    // ---- Divider ----
    doc.moveTo(M, cursorY).lineTo(M + contentWidth, cursorY)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke();
    cursorY += 16;

    // ---- Summary ----
    const summaryTotal = Number(data.total ?? 0);
    const summaryPaid = Number(data.paid ?? 0);
    const summaryBalance = Number(data.balance ?? 0);

    if (isEstimate) {
      // Estimate: show ONLY the total, then terms + signature
      doc.fontSize(10).fillColor('#6b7280')
        .text('ESTIMATE TOTAL', M, cursorY, { width: contentWidth });
      cursorY += 16;
      doc.fontSize(22).fillColor('#111827')
        .text(`$${formatMoney(summaryTotal)}`, M, cursorY, { width: contentWidth });
      cursorY += 36;

      doc.fontSize(9).fillColor('#6b7280')
        .text('This estimate is valid for 30 days. Prices subject to change based on final inspection.', M, cursorY, { width: contentWidth });
      cursorY += 24;

      // ---- Terms & Acceptance ----
      doc.moveTo(M, cursorY).lineTo(M + contentWidth, cursorY)
        .lineWidth(0.5).strokeColor('#d1d5db').stroke();
      cursorY += 16;

      doc.fontSize(10).fillColor('#6b7280')
        .text('TERMS & ACCEPTANCE', M, cursorY, { width: contentWidth });
      cursorY += 20;

      doc.fontSize(9).fillColor('#374151')
        .text('By signing below, you authorize the work described above at the stated price.', M, cursorY, { width: contentWidth });
      cursorY += 28;

      // Signature line
      doc.moveTo(M, cursorY).lineTo(M + 220, cursorY)
        .lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.fontSize(9).fillColor('#666666')
        .text('Customer Signature', M, cursorY + 4, { width: 220 });

      doc.moveTo(M + 260, cursorY).lineTo(M + 380, cursorY)
        .lineWidth(0.8).strokeColor('#aaaaaa').stroke();
      doc.fontSize(9).fillColor('#666666')
        .text('Date', M + 260, cursorY + 4, { width: 120 });

      cursorY += 32;
    } else {
      // Invoice: Contract Price, Amount Paid, Balance Due — no dump fee
      doc.fontSize(10).fillColor('#6b7280')
        .text('INVOICE SUMMARY', M, cursorY, { width: contentWidth });
      cursorY += 16;

      const summaryRows = [
        { label: 'Contract Price', value: summaryTotal, bold: false },
        { label: 'Amount Paid', value: summaryPaid, bold: false },
        { label: 'Balance Due', value: summaryBalance, bold: true }
      ];

      summaryRows.forEach(({ label, value, bold }) => {
        // Light background on balance row
        if (bold) {
          doc.rect(M, cursorY - 4, contentWidth, 22)
            .fillColor('#f8fafc').fill();
          doc.moveTo(M, cursorY - 4).lineTo(M + contentWidth, cursorY - 4)
            .lineWidth(0.5).strokeColor('#e2e8f0').stroke();
        }
        doc.fontSize(bold ? 12 : 10)
          .fillColor(bold ? '#111827' : '#374151')
          .text(label, M + 8, cursorY, { width: contentWidth * 0.6 });
        doc.fontSize(bold ? 12 : 10)
          .fillColor(bold ? '#111827' : '#374151')
          .text(`$${formatMoney(value)}`, M, cursorY, { width: contentWidth - 8, align: 'right' });
        cursorY += bold ? 26 : 20;
      });

      cursorY += 16;
    }

    // ---- Closing ----
    doc.moveTo(M, cursorY).lineTo(M + contentWidth, cursorY)
      .lineWidth(0.5).strokeColor('#d1d5db').stroke();
    cursorY += 16;

    const closing = isEstimate
      ? 'Thank you for considering us!'
      : 'Thank you for your business!';
    doc.fontSize(10).fillColor('#6b7280')
      .text(closing, M, cursorY, { width: contentWidth, align: 'center' });

    doc.end();
  });
}

async function sendInvoiceEmail(to, pdfBuffer, emailConfig = {}, mode = 'invoice') {
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
      {
        filename: isEstimate ? 'estimate.pdf' : 'invoice.pdf',
        content: pdfBuffer
      }
    ]
  });
}

function buildInvoiceData({ client, latestNote = null, companyProfile = {}, mode = 'invoice' }) {
  // Only use the client's scope_of_work — notes never appear on invoices/estimates
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
    invoiceNumber: `${prefix}-${client.id}-${Date.now()}`,
    clientName: client.name || '',
    clientAddress: client.address || '',
    clientPhone: client.phone || '',
    clientEmail: client.email || '',
    workDescription,
    total: client.total ?? client.total_due ?? 0,
    paid: client.paid ?? client.amount_paid ?? 0,
    balance: client.balance ?? 0
  };
}

module.exports = {
  buildInvoiceData,
  generateInvoicePDF,
  sendInvoiceEmail
};
