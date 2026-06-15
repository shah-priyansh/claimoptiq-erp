const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const amountInWords = require('./amountInWords');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Tailwind primary palette (matches frontend theme)
const COLORS = {
  primary500: '#2563eb',
  primary600: '#1d4ed8',
  primary50:  '#eff6ff',
  primary100: '#dbeafe',
  ink:        '#111827',
  body:       '#374151',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  border:     '#e5e7eb',
  alt:        '#f9fafb',
  red:        '#dc2626',
  green:      '#16a34a',
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
    if (url.startsWith('/uploads/')) {
      const filename = path.basename(url);
      const abs = path.join(UPLOADS_DIR, filename);
      fs.readFile(abs, (err, data) => resolve(err ? null : data));
      return;
    }
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

// "TPA Desk — RAJESH PATEL (CCN 0001)" → "TPA Desk"
// Tolerant of em-dash and ascii hyphen with surrounding spaces.
const baseServiceName = (description, fallback) => {
  if (!description) return fallback;
  const parts = description.split(/\s+[—-]\s+/);
  return (parts[0] || description).trim() || fallback;
};

const renderInvoicePdf = async (invoice, hospital, template = {}) => {
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
      const H = doc.page.height;      // 842
      const PAD = 32;
      const RIGHT = W - PAD;
      let y = PAD;

      // ===== Top accent bar =====
      doc.rect(0, 0, W, 5).fill(COLORS.primary600);

      // ===== Header: logo + company info on left, invoice meta on right =====
      y = 36;
      const logoBoxX = PAD;
      const logoBoxY = y;
      const logoBoxW = 80;
      const logoBoxH = 80;
      if (logoBuf) {
        try {
          doc.image(logoBuf, logoBoxX, logoBoxY, { fit: [logoBoxW, logoBoxH], align: 'center', valign: 'center' });
        } catch { /* ignore */ }
      } else {
        // Fallback monogram pill
        doc.roundedRect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 8).fillAndStroke(COLORS.primary500, COLORS.primary500);
        const initials = (template.invoice_company_name || 'FCC')
          .split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(26)
          .text(initials, logoBoxX, logoBoxY + 26, { width: logoBoxW, align: 'center' });
      }

      // Company info next to the logo
      const companyX = logoBoxX + logoBoxW + 18;
      const companyW = (W / 2) - companyX + 30;
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(14)
        .text(template.invoice_company_name || 'Company', companyX, logoBoxY + 4, { width: companyW });
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5);
      let cy = doc.y + 6;
      const addrLines = [
        template.invoice_company_address,
        template.invoice_company_phone ? `Phone: ${template.invoice_company_phone}` : '',
        template.invoice_company_email,
        template.invoice_company_website,
      ].filter(Boolean);
      addrLines.forEach((line) => {
        doc.text(line, companyX, cy, { width: companyW });
        cy = doc.y + 2;
      });

      // ===== TAX INVOICE block on the right =====
      const tiX = W / 2 + 40;
      const tiW = RIGHT - tiX;
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(26)
        .text('TAX INVOICE', tiX, logoBoxY - 4, { width: tiW, align: 'right' });

      const invoiceMeta = [
        ['Invoice No.', invoice.invoiceNumber || `Draft-${(invoice.id || '').slice(0, 8)}`],
        ['Date', formatDate(invoice.issuedAt || invoice.createdAt)],
        ['Time', formatTime(invoice.issuedAt || invoice.createdAt)],
        ['Due', invoice.dueDate ? formatDate(invoice.dueDate) : null],
      ].filter(([, v]) => v);
      let metaY = logoBoxY + 36;
      const metaRowH = 14;
      invoiceMeta.forEach(([label, value]) => {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5)
          .text(label, tiX, metaY + 1, { width: tiW / 2 - 6, align: 'right' });
        doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10)
          .text(value, tiX + tiW / 2 - 6, metaY, { width: tiW / 2 + 6, align: 'right' });
        metaY += metaRowH;
      });

      y = Math.max(logoBoxY + logoBoxH, metaY) + 22;

      // ===== Bill To card =====
      const billH = 88;
      doc.lineWidth(1).strokeColor(COLORS.border);
      doc.roundedRect(PAD, y, W - 2 * PAD, billH, 6).fillAndStroke(COLORS.alt, COLORS.border);

      const cardPad = 16;
      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
        .text('BILL TO', PAD + cardPad, y + cardPad - 2, { characterSpacing: 1 });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13)
        .text(hospital.name || '-', PAD + cardPad, y + cardPad + 11, { width: (W - 2 * PAD) / 2 - cardPad });

      const addrPieces = [
        hospital.address,
        [hospital.city, hospital.state, hospital.pincode].filter(Boolean).join(', '),
        hospital.phone ? `Phone: ${hospital.phone}` : '',
      ].filter(Boolean);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5);
      let bly = doc.y + 4;
      addrPieces.forEach((line) => {
        doc.text(line, PAD + cardPad, bly, { width: (W - 2 * PAD) / 2 - cardPad });
        bly = doc.y + 2;
      });

      // Right side of Bill To — invoice status + balance due preview
      const statusX = PAD + (W - 2 * PAD) / 2;
      const statusW = (W - 2 * PAD) / 2 - cardPad;
      const statusLabel = (invoice.status || 'draft').replace('_', ' ').toUpperCase();
      const statusColor = invoice.status === 'paid' ? COLORS.green
        : invoice.status === 'void' ? COLORS.red
        : invoice.status === 'partially_paid' ? '#f59e0b'
        : COLORS.primary600;
      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
        .text('STATUS', statusX, y + cardPad - 2, { width: statusW, align: 'right', characterSpacing: 1 });
      doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(13)
        .text(statusLabel, statusX, y + cardPad + 11, { width: statusW, align: 'right' });
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5)
        .text('Balance Due', statusX, y + cardPad + 38, { width: statusW, align: 'right' });
      doc.fillColor(invoice.amountPending > 0 ? COLORS.red : COLORS.green)
        .font('Helvetica-Bold').fontSize(12)
        .text(formatINR(invoice.amountPending), statusX, y + cardPad + 50, { width: statusW, align: 'right' });

      y += billH + 20;

      // ===== Line items table =====
      // Cleaner: no full blue header — instead a thin underline + light alt rows.
      const tableCols = [
        { key: 'sr',    label: '#',          x: PAD,       w: 26,  align: 'center' },
        { key: 'name',  label: 'Description', x: PAD + 26,  w: 270, align: 'left'  },
        { key: 'qty',   label: 'Qty',        x: PAD + 296, w: 50,  align: 'right' },
        { key: 'rate',  label: 'Rate',       x: PAD + 346, w: 80,  align: 'right' },
        { key: 'amt',   label: 'Amount',     x: PAD + 426, w: RIGHT - (PAD + 426), align: 'right' },
      ];

      const thH = 26;
      doc.rect(PAD, y, W - 2 * PAD, thH).fill(COLORS.primary50);
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(9);
      tableCols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 6, y + 9, { width: c.w - 12, align: c.align, characterSpacing: 0.5 }));
      y += thH;
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(PAD, y).lineTo(RIGHT, y).stroke();

      // Group claim_tpa_desk + service_percentage by service so big imports stay compact.
      const allLines = invoice.lineItems || [];
      const groupableTypes = new Set(['claim_tpa_desk', 'service_percentage']);
      const buckets = new Map();
      const standalone = [];
      for (const line of allLines) {
        if (!groupableTypes.has(line.lineType)) {
          standalone.push(line);
          continue;
        }
        const key = line.billingServiceNameId || line.lineType;
        const label = baseServiceName(line.description, line.lineType.replace('_', ' '));
        const cur = buckets.get(key) || { name: label, count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += Number(line.amount) || 0;
        buckets.set(key, cur);
      }

      const bodyRows = [
        ...Array.from(buckets.values()).map((b) => ({
          name: b.count > 1 ? `${b.name} (${b.count} claims)` : b.name,
          qty:  String(b.count),
          rate: formatINR(b.amount / Math.max(b.count, 1)),
          amount: b.amount,
        })),
        ...standalone.map((line) => ({
          name: line.description,
          qty:  '1',
          rate: formatINR(line.amount),
          amount: Number(line.amount) || 0,
        })),
      ];

      const rowH = 26;
      let srNo = 1;
      bodyRows.forEach((row, i) => {
        if (y > 700) { doc.addPage(); y = PAD; }
        if (i % 2 === 1) {
          doc.rect(PAD, y, W - 2 * PAD, rowH).fill(COLORS.alt);
        }
        const data = {
          sr:   String(srNo++),
          name: row.name,
          qty:  row.qty,
          rate: row.rate,
          amt:  formatINR(row.amount),
        };
        tableCols.forEach((c) => {
          const isAmt = c.key === 'amt';
          const isName = c.key === 'name';
          doc.fillColor(COLORS.ink)
            .font(isName || isAmt ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9.5)
            .text(data[c.key], c.x + 6, y + 9, { width: c.w - 12, align: c.align });
        });
        y += rowH;
      });

      // Subtotal line (just gross above the totals card)
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(PAD, y).lineTo(RIGHT, y).stroke();
      y += 22;

      // ===== Two columns: left = words/terms/bank ; right = totals card =====
      const colsBottomW = (W - 2 * PAD - 14) / 2;
      const leftStart = y;
      const rightColXBottom = PAD + colsBottomW + 14;

      // ----- LEFT column -----
      let leftY = leftStart;

      // Amount in words
      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
        .text('INVOICE AMOUNT IN WORDS', PAD, leftY, { characterSpacing: 1 });
      leftY = doc.y + 6;
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9.5)
        .text(amountInWords(invoice.gross), PAD, leftY, { width: colsBottomW });
      leftY = doc.y + 18;

      // Terms
      if (template.invoice_terms) {
        doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
          .text('TERMS & CONDITIONS', PAD, leftY, { characterSpacing: 1 });
        leftY = doc.y + 6;
        doc.fillColor(COLORS.body).font('Helvetica').fontSize(8.5);
        const termsLines = template.invoice_terms.split('\n').filter((s) => s.trim());
        termsLines.forEach((line) => {
          doc.text(`• ${line.trim()}`, PAD, leftY, { width: colsBottomW, lineGap: 2 });
          leftY = doc.y + 4;
        });
        leftY += 14;
      }

      // Bank Details
      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
        .text('BANK DETAILS', PAD, leftY, { characterSpacing: 1 });
      leftY = doc.y + 6;

      const bankCardH = 110;
      doc.roundedRect(PAD, leftY, colsBottomW, bankCardH, 6).fillAndStroke(COLORS.alt, COLORS.border);

      const qrSize = 84;
      const qrX = PAD + 14;
      const qrY = leftY + (bankCardH - qrSize) / 2;
      if (qrDataUrl) {
        const base64 = qrDataUrl.split(',')[1];
        try { doc.image(Buffer.from(base64, 'base64'), qrX, qrY, { width: qrSize, height: qrSize }); }
        catch { /* skip */ }
      } else {
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .roundedRect(qrX, qrY, qrSize, qrSize, 4).stroke();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.faint)
          .text('Scan to pay\n(UPI not\nconfigured)', qrX, qrY + 30, { width: qrSize, align: 'center' });
      }

      const bankTextX = qrX + qrSize + 14;
      const bankTextW = colsBottomW - (qrSize + 42);
      const bankFieldH = 22;
      const bankLines = [
        ['BANK',     template.invoice_bank_name],
        ['A/C NO.',  template.invoice_bank_account_no],
        ['IFSC',     template.invoice_bank_ifsc],
        ['HOLDER',   template.invoice_bank_account_holder],
      ].filter(([, v]) => v);
      const bankBlockH = bankLines.length * bankFieldH;
      let bankY = leftY + (bankCardH - bankBlockH) / 2;
      bankLines.forEach(([label, val]) => {
        doc.font('Helvetica').fontSize(7).fillColor(COLORS.faint)
          .text(label, bankTextX, bankY, { width: bankTextW, characterSpacing: 0.8 });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.ink)
          .text(val, bankTextX, bankY + 9, { width: bankTextW });
        bankY += bankFieldH;
      });

      leftY += bankCardH + 14;

      // ----- RIGHT column: totals card -----
      let rightY = leftStart;

      doc.roundedRect(rightColXBottom, rightY, colsBottomW, 0.1, 6); // placeholder for layout reasoning

      const totalsCardX = rightColXBottom;
      const totalsCardW = colsBottomW;
      const totalsStartY = rightY;

      const drawTotalRow = (label, value, opts = {}) => {
        const { bold, valueColor, big, divider, faint } = opts;
        const lineH = big ? 36 : 26;
        if (divider) {
          doc.lineWidth(0.5).strokeColor(COLORS.border)
            .moveTo(totalsCardX + 14, rightY).lineTo(totalsCardX + totalsCardW - 14, rightY).stroke();
        }
        const textY = rightY + (big ? 12 : 8);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(big ? 11 : 9.5)
          .fillColor(faint ? COLORS.muted : COLORS.ink)
          .text(label, totalsCardX + 14, textY, { width: totalsCardW / 2 - 14, align: 'left' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(big ? 13 : 9.5)
          .fillColor(valueColor || COLORS.ink)
          .text(value, totalsCardX + totalsCardW / 2, textY - (big ? 1 : 0), { width: totalsCardW / 2 - 14, align: 'right' });
        rightY += lineH;
      };

      // Light card background
      doc.roundedRect(totalsCardX, totalsStartY, totalsCardW, 0, 6); // ranged later

      drawTotalRow('Sub Total', formatINR(invoice.gross), { faint: true });
      if (invoice.gstAmount) drawTotalRow(`GST (${invoice.gstRate}%)`, formatINR(invoice.gstAmount), { faint: true });
      if (invoice.tdsAmount) {
        const sectionLabel = invoice.tdsSection ? ` ${invoice.tdsSection}` : '';
        drawTotalRow(`TDS${sectionLabel} (${invoice.tdsRate}%)`, formatINR(-invoice.tdsAmount), { faint: true, valueColor: COLORS.red });
      }
      drawTotalRow('Net Total', formatINR(invoice.netTotal || invoice.gross), { bold: true, divider: true });
      if (invoice.previousBalance) {
        drawTotalRow('Previous Balance', formatINR(invoice.previousBalance), { faint: true });
      }

      // Grand Total emphasis: filled primary band
      const grandY = rightY + 4;
      const grandH = 42;
      doc.rect(totalsCardX, grandY, totalsCardW, grandH).fill(COLORS.primary600);
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
        .text('GRAND TOTAL', totalsCardX + 14, grandY + 16, { width: totalsCardW / 2 - 14, align: 'left' });
      doc.fontSize(15)
        .text(formatINR(invoice.grandTotal || invoice.netTotal), totalsCardX + totalsCardW / 2, grandY + 14, { width: totalsCardW / 2 - 14, align: 'right' });
      rightY = grandY + grandH + 4;

      if (invoice.amountPaid) drawTotalRow('Received', formatINR(invoice.amountPaid), { faint: true, valueColor: COLORS.green });
      drawTotalRow('Balance Due', formatINR(invoice.amountPending || 0), {
        bold: true,
        big: true,
        valueColor: (invoice.amountPending || 0) > 0 ? COLORS.red : COLORS.green,
        divider: true,
      });

      // Frame the totals card after we know its height
      doc.lineWidth(1).strokeColor(COLORS.border)
        .roundedRect(totalsCardX, totalsStartY, totalsCardW, rightY - totalsStartY, 6).stroke();

      // Signature block
      rightY += 36;
      const sigW = totalsCardW - 24;
      const sigX = totalsCardX + 12;
      doc.lineWidth(0.8).strokeColor(COLORS.faint)
        .moveTo(sigX, rightY).lineTo(sigX + sigW, rightY).stroke();
      rightY += 6;
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5)
        .text(`for ${template.invoice_company_name || 'Company'}`, sigX, rightY, { width: sigW, align: 'center' });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9.5)
        .text('Authorized Signatory', sigX, doc.y + 2, { width: sigW, align: 'center' });

      // ===== Footer =====
      const footerY = H - 24;
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(PAD, footerY - 8).lineTo(RIGHT, footerY - 8).stroke();
      doc.fillColor(COLORS.faint).font('Helvetica-Oblique').fontSize(7.5)
        .text(
          'This is a computer-generated invoice. No signature required when issued through the FCC ERP.',
          PAD, footerY - 4, { width: W - 2 * PAD, align: 'center' },
        );

      // ===== Page 2: Claims Summary =====
      const claimLines = (invoice.lineItems || []).filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId);
      if (claimLines.length) {
        doc.addPage();
        doc.rect(0, 0, W, 6).fill(COLORS.primary600);
        let cy = 24;

        // Header line
        doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16)
          .text('Claims Summary', PAD, cy);
        const monthLbl = invoice.month
          ? new Date(invoice.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
          : '';
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
          .text(
            `Invoice ${invoice.invoiceNumber || 'Draft'}${monthLbl ? '  ·  ' + monthLbl : ''}  ·  ${claimLines.length} claim${claimLines.length === 1 ? '' : 's'}`,
            PAD, cy, { width: W - 2 * PAD, align: 'right' },
          );
        cy += 30;

        const sumCols = [
          { key: 'sr',      label: '#',         x: PAD,        w: 30,  align: 'center' },
          { key: 'patient', label: 'Patient',   x: PAD + 30,   w: 200, align: 'left' },
          { key: 'ccn',     label: 'CCN No.',   x: PAD + 230,  w: 110, align: 'left' },
          { key: 'final',   label: 'Final Approval', x: PAD + 340, w: 100, align: 'right' },
          { key: 'amount',  label: 'TPA Fee',   x: PAD + 440,  w: RIGHT - (PAD + 440), align: 'right' },
        ];

        doc.rect(PAD, cy, W - 2 * PAD, 24).fill(COLORS.primary50);
        doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(9);
        sumCols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 4, cy + 8, { width: c.w - 8, align: c.align, characterSpacing: 0.5 }));
        cy += 24;

        doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
        let total = 0;
        const sumRowH = 20;
        claimLines.forEach((line, i) => {
          if (cy > 740) { doc.addPage(); cy = PAD; }
          if (i % 2 === 1) {
            doc.rect(PAD, cy, W - 2 * PAD, sumRowH).fill(COLORS.alt);
          }
          const finalApproval = line.meta?.finalApprovalAmount || 0;
          const patientMatch = (line.description || '').match(/[—-]\s*(.+?)\s*(\(CCN\s*(.+?)\))?$/);
          const patient = patientMatch?.[1] || line.description;
          const ccn = patientMatch?.[3] || '';
          total += Number(line.amount) || 0;
          const data = {
            sr:      String(i + 1),
            patient,
            ccn:     ccn || '-',
            final:   formatINR(finalApproval),
            amount:  formatINR(line.amount),
          };
          sumCols.forEach((c) => {
            doc.fillColor(COLORS.ink).font(c.key === 'patient' || c.key === 'amount' ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(9.5)
              .text(data[c.key], c.x + 4, cy + 6, { width: c.w - 8, align: c.align });
          });
          cy += sumRowH;
        });

        // Bottom rule + total
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .moveTo(PAD, cy).lineTo(RIGHT, cy).stroke();
        cy += 8;

        if (cy > 740) { doc.addPage(); cy = PAD; }
        doc.rect(PAD, cy, W - 2 * PAD, 28).fill(COLORS.primary600);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11);
        doc.text(`Total — ${claimLines.length} claim${claimLines.length === 1 ? '' : 's'}`, PAD + 12, cy + 9);
        doc.text(formatINR(total), sumCols[4].x + 4, cy + 9, { width: sumCols[4].w - 8, align: 'right' });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
};

module.exports = renderInvoicePdf;
