const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

const BUSINESS_NAME = process.env.BUSINESS_NAME || 'Your Company Name';
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || 'Your Address';
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || 'Your Phone';
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'your@email.com';

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0.00';
  return num.toFixed(2);
}

function generateInvoicePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'LETTER' });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      resolve(Buffer.concat(buffers));
    });
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#111827').text(data.businessName);
    doc.fontSize(10).fillColor('#4b5563').text(data.businessAddress);
    doc.text(data.businessPhone);
    doc.text(data.businessEmail);

    doc.moveDown(1.2);
    doc.fontSize(12).fillColor('#111827').text(`Date: ${data.date}`);
    doc.text(`Invoice #: ${data.invoiceNumber}`);

    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text('Customer Information', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827');
    doc.text(`Name: ${data.clientName}`);
    doc.text(`Address: ${data.clientAddress}`);
    doc.text(`Phone: ${data.clientPhone}`);
    doc.text(`Email: ${data.clientEmail}`);

    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text('Work Completed', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827').text(data.workDescription || 'No work description provided.');

    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text('Invoice Summary', { underline: true });
    doc.moveDown(0.4);
    doc.fontSize(11).fillColor('#111827');
    doc.text(`Total: $${formatMoney(data.total)}`);
    doc.text(`Amount Paid: $${formatMoney(data.paid)}`);
    doc.text(`Balance Due: $${formatMoney(data.balance)}`);

    doc.moveDown(1.2);
    doc.fontSize(11).fillColor('#374151').text('Thank you for your business!');

    doc.end();
  });
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendInvoiceEmail(to, pdfBuffer) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be configured');
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: 'Your Invoice',
    text: 'Attached is your invoice. Thank you for your business.',
    attachments: [
      {
        filename: 'invoice.pdf',
        content: pdfBuffer
      }
    ]
  });
}

function buildInvoiceData({ client, latestNote = null }) {
  const workDescription =
    client.work_description ||
    client.job_description ||
    client.description ||
    latestNote?.content ||
    client.status ||
    'Work details not provided.';

  return {
    businessName: BUSINESS_NAME,
    businessAddress: BUSINESS_ADDRESS,
    businessPhone: BUSINESS_PHONE,
    businessEmail: BUSINESS_EMAIL,
    date: new Date().toLocaleDateString(),
    invoiceNumber: `INV-${client.id}-${Date.now()}`,
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
