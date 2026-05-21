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

function getLogoBuffer(logoBase64) {
  if (!logoBase64) return null;

  const raw = String(logoBase64).trim();
  const match = raw.match(/^data:image\/[^;]+;base64,(.+)$/);
  const base64 = match ? match[1] : raw;

  try {
    return Buffer.from(base64, 'base64');
  } catch {
    return null;
  }
}

function drawHeader(doc, data, mode) {
  const isEstimate = mode === 'estimate';
  const pageWidth = doc.page.width;
  const left = 48;
  const companyName = safeText(data.businessName, 'Your Company Name');
  const companyAddress = safeText(data.businessAddress, 'Your Address');
  const companyPhone = safeText(data.businessPhone, 'Your Phone');
  const companyEmail = safeText(data.businessEmail, 'your@email.com');

  const logoBuffer = getLogoBuffer(data.logoBase64);
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, (pageWidth - 120) / 2, 92, { fit: [120, 72] });
    } catch {
      // Ignore logo failures and continue with the text layout.
    }
  }

  doc
    .fontSize(18)
    .fillColor('#222222')
    .text(companyName, left, 302, { width: pageWidth - 96 });

  doc
    .fontSize(11)
    .fillColor('#333333')
    .text(companyAddress, left, 338, { width: pageWidth - 96 })
    .text(companyPhone, left, 354, { width: pageWidth - 96 })
    .fillColor('#2a5db0')
    .text(companyEmail, left, 370, { width: pageWidth - 96, underline: true });

  const dateText = safeText(data.date, '');
  doc
    .moveDown(0.4)
    .fontSize(11)
    .fillColor('#333333')
    .text(`Date: ${dateText}`, left, 406, { width: pageWidth - 96 });

  return { isEstimate };
}

function normalizeWorkLines(workDescription) {
  const rawLines = String(workDescription || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return ['No scope of work provided.'];

  return rawLines.map((line) => line.replace(/^[•\-*]\s*/, ''));
}

function drawTextSection(doc, title, lines, x, y, width) {
  doc.fontSize(12).fillColor('#333333').text(title, x, y);
  let cursorY = y + 26;

  lines.forEach((line) => {
    doc.fontSize(11).fillColor('#222222').text('•', x + 2, cursorY, {
      width: 10
    });
    doc.fontSize(11).fillColor('#222222').text(line, x + 18, cursorY, {
      width: width - 18,
      lineGap: 2
    });
    cursorY += doc.heightOfString(line, { width: width - 18, lineGap: 2 }) + 4;
  });

  return cursorY;
}

function drawSummaryLine(doc, label, value, x, y, width, bold = false) {
  doc
    .fontSize(bold ? 12 : 11)
    .fillColor('#222222')
    .text(`${label}: $${formatMoney(value)}`, x, y, { width });
  return y + (bold ? 24 : 18);
}

// ======================================================
// GENERATE INVOICE OR ESTIMATE PDF
// mode: 'invoice' | 'estimate'
// ======================================================
function generateInvoicePDF(data, mode = 'invoice') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const isEstimate = mode === 'estimate';
    const docTitle = isEstimate ? 'ESTIMATE' : 'INVOICE';

    const pageWidth = doc.page.width;
    const left = 48;
    const contentWidth = pageWidth - 96;

    const clientName = safeText(data.clientName, 'Client Name');
    const clientAddress = safeText(data.clientAddress, 'Client Address');
    const clientPhone = safeText(data.clientPhone, 'Client Phone');
    const clientEmail = safeText(data.clientEmail, 'Client Email');
    const workDescription = safeText(data.workDescription, 'No scope of work provided.');
    const invoiceNumber = safeText(data.invoiceNumber, `${isEstimate ? 'EST' : 'INV'}-0000`);

    drawHeader(doc, data, mode);

    doc
      .fontSize(11)
      .fillColor('#333333')
      .text(`Customer Information`, left, 430, { width: contentWidth });

    doc
      .fontSize(11)
      .fillColor('#222222')
      .text(`Name: ${clientName}`, left, 460, { width: contentWidth })
      .text(`Address: ${clientAddress}`, left, 476, { width: contentWidth })
      .text(`Phone: ${clientPhone}`, left, 492, { width: contentWidth })
      .fillColor('#2a5db0')
      .text(`Email: ${clientEmail}`, left, 508, { width: contentWidth, underline: true });

    let cursorY = 546;
    cursorY = drawTextSection(doc, isEstimate ? 'Scope of Work' : 'Work Completed', normalizeWorkLines(workDescription), left, cursorY, contentWidth);

    cursorY += 10;
    doc.fontSize(12).fillColor('#333333').text(isEstimate ? 'Estimate Summary' : 'Invoice Summary', left, cursorY);
    cursorY += 26;

    const summaryTotal = Number(data.total ?? 0);
    const summaryPaid = Number(data.paid ?? 0);
    const summaryBalance = Number(data.balance ?? 0);

    cursorY = drawSummaryLine(doc, isEstimate ? 'Estimated Total' : 'Contract Price', summaryTotal, left, cursorY, contentWidth);
    cursorY = drawSummaryLine(doc, isEstimate ? 'Deposit / Down Payment' : 'Amount Paid', summaryPaid, left, cursorY, contentWidth);
    cursorY = drawSummaryLine(doc, 'Balance Due', summaryBalance, left, cursorY, contentWidth, true);

    doc
      .moveDown(0.9)
      .fontSize(11)
      .fillColor('#222222')
      .text(
        isEstimate
          ? 'Thank you for considering us. This estimate is valid for 30 days.'
          : 'Thank you for your business!',
        left,
        cursorY + 10,
        { width: contentWidth }
      );

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
  // Only use the client's scope_of_work; notes never appear on invoices/estimates.
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
