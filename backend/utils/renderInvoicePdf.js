const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');
const amountInWords = require('./amountInWords');

// Tailwind primary palette (matches frontend theme)
const COLORS = {
  primary500: '#2563eb',
  primary600: '#1d4ed8',
  primary50:  '#eff6ff',
  primary100: '#dbeafe',
  ink:        '#111827',
  muted:      '#6b7280',
  border:     '#e5e7eb',
  red:        '#dc2626',
};

const formatINR = (n) => {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? '- ' : '';
  return sign + 'Rs. ' + Math.abs(v).toLocaleString('en-IN') + '.00';
};

const formatDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
};

const formatTime = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const fetchBuffer = (url) =>
  new Promise((resolve) => {
    if (!url || typeof url !== 'string') return resolve(null);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(2500, () => { req.destroy(); resolve(null); });
  });

const renderInvoicePdf = async (invoice, hospital, template = {}) => {
  // Pre-fetch logo + QR (parallel)
  const upiId = template.invoice_upi_id || '';
  const upiPayload = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(template.invoice_company_name || '')}&am=${Math.round(invoice.amountPending || invoice.grandTotal || 0)}&cu=INR`
    : null;
  const [logoBuf, qrDataUrl] = await Promise.all([
    template.invoice_logo_url ? fetchBuffer(template.invoice_logo_url) : Promise.resolve(null),
    upiPayload ? QRCode.toDataURL(upiPayload, { margin: 0, width: 110 }) : Promise.resolve(null),
  ]);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;       // 595
      const PAD = 30;
      const RIGHT = W - PAD;
      let y = PAD;

      // ===== Header band =====
      const headerH = 90;
      doc.rect(PAD, y, W - 2 * PAD, headerH).fillAndStroke(COLORS.primary500, COLORS.primary500);

      // Logo (left) — white card if logo provided, else text initials in white card
      const logoBoxX = PAD + 8;
      const logoBoxY = y + 8;
      const logoBoxW = 110;
      const logoBoxH = headerH - 16;
      doc.rect(logoBoxX, logoBoxY, logoBoxW, logoBoxH).fillAndStroke('#ffffff', '#ffffff');
      if (logoBuf) {
        try { doc.image(logoBuf, logoBoxX + 8, logoBoxY + 8, { fit: [logoBoxW - 16, logoBoxH - 16], align: 'center', valign: 'center' }); }
        catch { /* ignore broken image, fall back to text */ }
      } else {
        doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(11)
          .text(template.invoice_company_name || 'First Care\nConsultancy', logoBoxX, logoBoxY + 25, { width: logoBoxW, align: 'center' });
      }

      // Right-side company address (white text on primary)
      const rightX = logoBoxX + logoBoxW + 20;
      const rightW = RIGHT - rightX - 6;
      doc.fillColor('#ffffff').font('Helvetica').fontSize(9);
      const headerLines = [
        template.invoice_company_address,
        template.invoice_company_phone ? `Phone no.: ${template.invoice_company_phone}` : '',
        template.invoice_company_email ? `Email: ${template.invoice_company_email}` : '',
        template.invoice_company_website ? `Website: ${template.invoice_company_website}` : '',
      ].filter(Boolean);
      let hy = y + 12;
      for (const line of headerLines) {
        doc.text(line, rightX, hy, { width: rightW, align: 'right' });
        hy = doc.y + 2;
      }

      y += headerH + 8;

      // ===== Tax Invoice title =====
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(15)
        .text('Tax Invoice', PAD, y, { width: W - 2 * PAD, align: 'center' });
      y += 24;

      // ===== Bill To / Invoice Details =====
      const colW = (W - 2 * PAD - 8) / 2;
      const leftColX = PAD;
      const rightColX = PAD + colW + 8;

      const headerBarH = 18;
      doc.rect(leftColX, y, colW, headerBarH).fill(COLORS.primary500);
      doc.rect(rightColX, y, colW, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text('Bill To', leftColX + 8, y + 5);
      doc.text('Invoice Details', rightColX + 8, y + 5, { width: colW - 16, align: 'right' });

      const billBoxY = y + headerBarH;
      const billBoxH = 56;
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .rect(leftColX, billBoxY, colW, billBoxH).stroke()
        .rect(rightColX, billBoxY, colW, billBoxH).stroke();

      // Bill To content
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11)
        .text(hospital.name || '-', leftColX + 8, billBoxY + 7, { width: colW - 16 });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
        .text(hospital.phone ? `Contact No. : ${hospital.phone}` : '', leftColX + 8, doc.y + 4, { width: colW - 16 });

      // Invoice Details content (right aligned)
      const dRight = rightColX + colW - 8;
      const labelOpts = { width: colW - 16, align: 'right' };
      let detailY = billBoxY + 7;
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9);
      doc.text(`Invoice No. : ${invoice.invoiceNumber || 'Draft'}`, rightColX + 8, detailY, labelOpts);
      detailY = doc.y + 2;
      doc.text(`Date : ${formatDate(invoice.issuedAt || invoice.createdAt)}`, rightColX + 8, detailY, labelOpts);
      detailY = doc.y + 2;
      const t = formatTime(invoice.issuedAt || invoice.createdAt);
      if (t) doc.text(`Time : ${t}`, rightColX + 8, detailY, labelOpts);

      y = billBoxY + billBoxH + 10;

      // ===== Line items table =====
      const tableCols = [
        { key: 'sr',   label: '#',         x: PAD,        w: 30,  align: 'center' },
        { key: 'name', label: 'Item name', x: PAD + 30,   w: 240, align: 'left' },
        { key: 'qty',  label: 'Quantity',  x: PAD + 270,  w: 70,  align: 'right' },
        { key: 'rate', label: 'Price/ Unit', x: PAD + 340, w: 90, align: 'right' },
        { key: 'amt',  label: 'Amount',    x: PAD + 430,  w: RIGHT - (PAD + 430), align: 'right' },
      ];

      // Table header
      doc.rect(PAD, y, W - 2 * PAD, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
      tableCols.forEach((c) => doc.text(c.label, c.x + 4, y + 5, { width: c.w - 8, align: c.align }));
      y += headerBarH;

      // Body rows — keep ALL lines visible (claim_tpa_desk + service_fixed + adjustment)
      const allLines = invoice.lineItems || [];
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
      let srNo = 1;
      const rowH = 20;
      allLines.forEach((line) => {
        if (y > 720) { doc.addPage(); y = PAD; }
        const yStart = y;
        const data = {
          sr:   String(srNo++),
          name: line.description,
          qty:  '1',
          rate: formatINR(line.amount),
          amt:  formatINR(line.amount),
        };
        tableCols.forEach((c) => {
          if (c.key === 'name') doc.font('Helvetica-Bold');
          else doc.font('Helvetica');
          doc.fillColor(COLORS.ink).text(data[c.key], c.x + 4, yStart + 5, { width: c.w - 8, align: c.align });
        });
        // Cell borders
        doc.lineWidth(0.4).strokeColor(COLORS.border);
        tableCols.forEach((c) => doc.rect(c.x, yStart, c.w, rowH).stroke());
        y += rowH;
      });

      // Total row
      doc.rect(PAD, y, W - 2 * PAD, rowH).fillAndStroke(COLORS.primary50, COLORS.border);
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10);
      doc.text('Total', PAD + 34, y + 5);
      doc.text(formatINR(invoice.gross), tableCols[4].x + 4, y + 5, { width: tableCols[4].w - 8, align: 'right' });
      y += rowH + 12;

      // ===== Two-column bottom area: Words+Terms on left, Amounts on right =====
      const bottomY = y;
      const colsBottomW = (W - 2 * PAD - 8) / 2;

      // ----- LEFT: Amount in Words band + Terms band -----
      let leftY = bottomY;
      doc.rect(PAD, leftY, colsBottomW, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('Invoice Amount In Words', PAD + 8, leftY + 5);
      leftY += headerBarH;

      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9);
      doc.text(amountInWords(invoice.gross), PAD + 8, leftY + 6, { width: colsBottomW - 16 });
      leftY = doc.y + 8;

      // Terms band
      doc.rect(PAD, leftY, colsBottomW, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('Terms and Conditions', PAD + 8, leftY + 5);
      leftY += headerBarH;

      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9);
      const termsLines = (template.invoice_terms || '').split('\n').filter((s) => s.trim());
      termsLines.forEach((line) => {
        doc.text(line.trim(), PAD + 8, leftY + 4, { width: colsBottomW - 16 });
        leftY = doc.y + 2;
      });
      leftY += 8;

      // Bank Details band
      doc.rect(PAD, leftY, colsBottomW, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('Bank Details', PAD + 8, leftY + 5);
      leftY += headerBarH;

      const bankBoxY = leftY;
      const qrSize = 70;
      // QR (left)
      if (qrDataUrl) {
        const base64 = qrDataUrl.split(',')[1];
        try { doc.image(Buffer.from(base64, 'base64'), PAD + 8, bankBoxY + 8, { width: qrSize, height: qrSize }); }
        catch { /* skip */ }
      } else {
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .rect(PAD + 8, bankBoxY + 8, qrSize, qrSize).stroke();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.muted)
          .text('QR not\nconfigured', PAD + 8, bankBoxY + 32, { width: qrSize, align: 'center' });
      }

      // Bank text (right of QR)
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9);
      const bankTextX = PAD + 8 + qrSize + 10;
      const bankTextW = colsBottomW - (qrSize + 26);
      let bankY = bankBoxY + 10;
      const bankLines = [
        ['Name', template.invoice_bank_name],
        ['Account No.', template.invoice_bank_account_no],
        ['IFSC code', template.invoice_bank_ifsc],
        ["Account holder's name", template.invoice_bank_account_holder],
      ];
      bankLines.forEach(([label, val]) => {
        if (!val) return;
        doc.font('Helvetica').fillColor(COLORS.muted).text(`${label} : `, bankTextX, bankY, { continued: true, width: bankTextW });
        doc.font('Helvetica-Bold').fillColor(COLORS.ink).text(val);
        bankY = doc.y + 2;
      });
      leftY = bankBoxY + qrSize + 16;

      // ----- RIGHT: Amounts band -----
      let rightY = bottomY;
      const rightColXBottom = PAD + colsBottomW + 8;

      doc.rect(rightColXBottom, rightY, colsBottomW, headerBarH).fill(COLORS.primary500);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text('Amounts', rightColXBottom + 8, rightY + 5);
      rightY += headerBarH;

      const drawAmtRow = (label, value, bold = false, valueColor) => {
        const yy = rightY;
        const labelOpts = { width: colsBottomW / 2 - 8, align: 'left' };
        const valOpts = { width: colsBottomW / 2 - 8, align: 'right' };
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(COLORS.ink)
          .text(label, rightColXBottom + 8, yy + 5, labelOpts);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(valueColor || COLORS.ink)
          .text(value, rightColXBottom + colsBottomW / 2, yy + 5, valOpts);
        doc.lineWidth(0.4).strokeColor(COLORS.border)
          .moveTo(rightColXBottom, yy + rowH).lineTo(rightColXBottom + colsBottomW, yy + rowH).stroke();
        rightY += rowH;
      };

      drawAmtRow('Sub Total', formatINR(invoice.gross));
      if (invoice.gstAmount) drawAmtRow(`GST (${invoice.gstRate}%)`, formatINR(invoice.gstAmount));
      if (invoice.tdsAmount) {
        const sectionLabel = invoice.tdsSection ? ` ${invoice.tdsSection}` : '';
        const nameLabel = invoice.tdsName ? ` — ${invoice.tdsName}` : '';
        drawAmtRow(`TDS${sectionLabel} (${invoice.tdsRate}%)${nameLabel}`, formatINR(-invoice.tdsAmount), false, COLORS.red);
      }
      drawAmtRow('Total', formatINR(invoice.netTotal || invoice.gross), true);
      drawAmtRow('Received', formatINR(invoice.amountPaid));
      const thisInvoiceBalance = (invoice.netTotal || invoice.gross || 0) - (invoice.amountPaid || 0);
      drawAmtRow('Balance', formatINR(thisInvoiceBalance));
      if (invoice.previousBalance) {
        drawAmtRow('Previous Balance', formatINR(-invoice.previousBalance), false, COLORS.red);
      }
      drawAmtRow('Current Balance', formatINR(-(invoice.amountPending || 0)), true, COLORS.red);

      // Signatory at bottom-right
      rightY += 20;
      doc.fillColor(COLORS.ink).font('Helvetica').fontSize(9)
        .text(`For : ${template.invoice_company_name || 'Company'}`, rightColXBottom, rightY, { width: colsBottomW, align: 'center' });
      rightY += 40;
      doc.font('Helvetica-Bold').fontSize(10)
        .text('Authorized Signatory', rightColXBottom, rightY, { width: colsBottomW, align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
};

module.exports = renderInvoicePdf;
