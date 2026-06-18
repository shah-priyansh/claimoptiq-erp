const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const amountInWords = require('./amountInWords');
const { parseSelected, resolveColumns } = require('./invoiceSummaryFields');

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

const renderInvoicePdf = async (invoice, hospital, template = {}, opts = {}) => {
  const { claimsById = new Map() } = opts;
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
      const cardPad = 16;
      const billCardW = W - 2 * PAD;
      const billContentW = billCardW - 2 * cardPad;

      // Pre-measure the content so the card hugs it instead of leaving dead space.
      const nameH = doc.font('Helvetica-Bold').fontSize(13)
        .heightOfString(hospital.name || '-', { width: billContentW });
      const addrPieces = [
        hospital.address,
        [hospital.city, hospital.state, hospital.pincode].filter(Boolean).join(', '),
        hospital.phone ? `Phone: ${hospital.phone}` : '',
      ].filter(Boolean);
      doc.font('Helvetica').fontSize(8.5);
      const addrH = addrPieces.reduce(
        (acc, line) => acc + doc.heightOfString(line, { width: billContentW }) + 2,
        0,
      );
      // 8 (BILL TO label) + 3 gap + nameH + 4 gap + addrH + cardPad top/bottom
      const billH = Math.max(72, cardPad + 8 + 3 + nameH + 4 + addrH + cardPad);

      doc.lineWidth(1).strokeColor(COLORS.border);
      doc.roundedRect(PAD, y, billCardW, billH, 6).fillAndStroke(COLORS.alt, COLORS.border);

      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(8)
        .text('BILL TO', PAD + cardPad, y + cardPad - 2, { characterSpacing: 1 });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(13)
        .text(hospital.name || '-', PAD + cardPad, y + cardPad + 11, { width: billContentW });

      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5);
      let bly = doc.y + 4;
      addrPieces.forEach((line) => {
        doc.text(line, PAD + cardPad, bly, { width: billContentW });
        bly = doc.y + 2;
      });

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

      // ----- LEFT column (top): Amount-in-words card → Terms card -----
      let leftY = leftStart;

      // Amount in words — primary-accented card with a left stripe
      const wordsText = amountInWords(invoice.gross);
      const wordsTextW = colsBottomW - 22;
      const wordsTextH = doc.font('Helvetica-Bold').fontSize(11)
        .heightOfString(wordsText, { width: wordsTextW });
      const wordsCardH = Math.max(48, 14 + wordsTextH + 12);
      doc.roundedRect(PAD, leftY, colsBottomW, wordsCardH, 8)
        .fillAndStroke(COLORS.primary50, COLORS.primary100);
      doc.rect(PAD, leftY, 3, wordsCardH).fill(COLORS.primary600);
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(7)
        .text('INVOICE AMOUNT IN WORDS', PAD + 12, leftY + 8,
          { width: wordsTextW, characterSpacing: 1 });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(11)
        .text(wordsText, PAD + 12, leftY + 20, { width: wordsTextW });
      leftY += wordsCardH + 12;

      // Terms — soft card with primary section header
      if (template.invoice_terms) {
        const termsLines = template.invoice_terms.split('\n').filter((s) => s.trim());
        doc.font('Helvetica').fontSize(8.5);
        const termTextW = colsBottomW - 24;
        const termsBodyH = termsLines.reduce(
          (acc, line) => acc + doc.heightOfString(`•  ${line.trim()}`, { width: termTextW, lineGap: 3 }) + 4,
          0,
        );
        const termsCardH = 22 + termsBodyH + 8;
        doc.roundedRect(PAD, leftY, colsBottomW, termsCardH, 8)
          .fillAndStroke(COLORS.alt, COLORS.border);
        doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(7)
          .text('TERMS & CONDITIONS', PAD + 12, leftY + 8,
            { width: termTextW, characterSpacing: 1 });
        let termY = leftY + 22;
        doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.body);
        termsLines.forEach((line) => {
          doc.text(`•  ${line.trim()}`, PAD + 12, termY, { width: termTextW, lineGap: 3 });
          termY = doc.y + 4;
        });
        leftY += termsCardH + 12;
      }

      // ----- RIGHT column: totals card -----
      const totalsCardX = rightColXBottom;
      const totalsCardW = colsBottomW;
      const totalsStartY = leftStart;
      let rightY = totalsStartY;

      // Tighter row engine. Each row paints its own background (zebra / band)
      // so the card reads as a single composed block instead of a list with
      // ad-hoc dividers between sections.
      const ROW_H = 22;
      const BAND_H = 28;
      const drawRow = (label, value, opts = {}) => {
        const { bold, valueColor, faint, band } = opts;
        const h = band ? BAND_H : ROW_H;
        if (band) {
          doc.rect(totalsCardX, rightY, totalsCardW, h).fill(band);
        }
        const textY = rightY + (h - 11) / 2 + 1;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(band ? 10.5 : 9)
          .fillColor(faint ? COLORS.muted : COLORS.ink)
          .text(label, totalsCardX + 14, textY, { width: totalsCardW / 2, align: 'left', lineBreak: false });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(band ? 11 : 9)
          .fillColor(valueColor || (band ? COLORS.ink : COLORS.ink))
          .text(value, totalsCardX + totalsCardW / 2, textY, { width: totalsCardW / 2 - 14, align: 'right', lineBreak: false });
        rightY += h;
      };
      const drawDivider = () => {
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .moveTo(totalsCardX + 14, rightY).lineTo(totalsCardX + totalsCardW - 14, rightY).stroke();
      };

      const gross = Number(invoice.gross) || 0;
      const discount = Number(invoice.discount) || 0;
      const taxable = Math.max(0, gross - discount);
      const tdsAmt = Number(invoice.tdsAmount) || 0;
      const gstAmt = Number(invoice.gstAmount) || 0;
      const netTotal = Number(invoice.netTotal) || (taxable + gstAmt - tdsAmt);
      const amountPaid = Number(invoice.amountPaid) || 0;
      const roundOff = Number(invoice.roundOff) || 0;
      const previousBalance = Number(invoice.previousBalance) || 0;
      const thisBalance = netTotal + roundOff - amountPaid;
      const currentBalance = thisBalance + previousBalance;

      // ---- Section 1: charges build-up ----
      drawRow('Sub Total', formatINR(gross), { faint: true });
      if (discount) {
        drawRow('Discount', `- ${formatINR(discount)}`, { faint: true, valueColor: COLORS.green });
        drawRow('Taxable Value', formatINR(taxable), { faint: true });
      }
      if (gstAmt) drawRow(`GST (${invoice.gstRate}%)`, formatINR(gstAmt), { faint: true });
      if (tdsAmt) {
        const section = invoice.tdsSection ? ` (${invoice.tdsSection})` : '';
        drawRow(`TDS @ ${invoice.tdsRate}%${section}`, `- ${formatINR(tdsAmt)}`, { faint: true, valueColor: COLORS.red });
      }
      if (roundOff) drawRow('Round Off', formatINR(roundOff), { faint: true });

      // ---- Section 2: net total band (primary tint) ----
      drawRow('Total', formatINR(netTotal), { bold: true, band: COLORS.primary50, valueColor: COLORS.primary600 });

      // ---- Section 3: payment status ----
      drawDivider();
      drawRow('Received', formatINR(amountPaid), { faint: true, valueColor: amountPaid ? COLORS.green : undefined });
      drawRow('Balance', formatINR(thisBalance), { faint: true });
      drawDivider();
      drawRow('Previous Balance', formatINR(previousBalance), { faint: true });

      // ---- Section 4: current balance band (red/green by sign) ----
      const balanceBg = currentBalance > 0 ? '#fef2f2' : '#f0fdf4'; // soft red / green
      const balanceFg = currentBalance > 0 ? COLORS.red : COLORS.green;
      drawRow('Current Balance', formatINR(currentBalance), { bold: true, band: balanceBg, valueColor: balanceFg });

      drawDivider();
      drawRow('Invoice Value Before TDS', formatINR(taxable), { bold: true });

      // Frame the totals card after we know its height (drawn on top so the
      // bands stay clipped to the rounded corners visually).
      doc.lineWidth(1).strokeColor(COLORS.border)
        .roundedRect(totalsCardX, totalsStartY, totalsCardW, rightY - totalsStartY, 8).stroke();

      // ===== Bottom block: Bank Details (left) + Signatory (right) =====
      // Flows naturally just below the taller of {terms, totals card} with a
      // small clearance, but is clamped so it never crashes into the footer.
      const footerY = H - 24;
      const footerRuleY = footerY - 8;
      const bankCardH = 118;
      const bottomBlockTop = Math.min(
        Math.max(leftY + 6, rightY + 16),
        footerRuleY - 12 - bankCardH,
      );

      // Section label header above the card (left)
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(8)
        .text('BANK DETAILS', PAD, bottomBlockTop - 14, { characterSpacing: 1 });

      doc.lineWidth(1).strokeColor(COLORS.border);
      doc.roundedRect(PAD, bottomBlockTop, colsBottomW, bankCardH, 8)
        .fillAndStroke(COLORS.alt, COLORS.border);

      // QR panel — white left strip with a "SCAN TO PAY" header and a UPI
      // wallet caption underneath. Slightly tighter than before so the bank
      // text area gets more room (avoids HOLDER name wrapping).
      const qrSize = 78;
      const qrPanelW = qrSize + 16;
      const qrPanelX = PAD;
      doc.roundedRect(qrPanelX, bottomBlockTop, qrPanelW, bankCardH, 8).fill('#ffffff');
      doc.lineWidth(1).strokeColor(COLORS.border)
        .roundedRect(PAD, bottomBlockTop, colsBottomW, bankCardH, 8).stroke();
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(qrPanelX + qrPanelW, bottomBlockTop + 6)
        .lineTo(qrPanelX + qrPanelW, bottomBlockTop + bankCardH - 6).stroke();

      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(7)
        .text('SCAN TO PAY', qrPanelX, bottomBlockTop + 8, { width: qrPanelW, align: 'center', characterSpacing: 1 });

      const qrX = qrPanelX + (qrPanelW - qrSize) / 2;
      const qrY = bottomBlockTop + 20;
      if (qrDataUrl) {
        const base64 = qrDataUrl.split(',')[1];
        try { doc.image(Buffer.from(base64, 'base64'), qrX, qrY, { width: qrSize, height: qrSize }); }
        catch { /* skip */ }
      } else {
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .roundedRect(qrX, qrY, qrSize, qrSize, 4).stroke();
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(COLORS.faint)
          .text('UPI not\nconfigured', qrX, qrY + 28, { width: qrSize, align: 'center' });
      }
      doc.fillColor(COLORS.faint).font('Helvetica').fontSize(6)
        .text('UPI · GPay · PhonePe', qrPanelX, bottomBlockTop + bankCardH - 10,
          { width: qrPanelW, align: 'center', characterSpacing: 0.3 });

      // Bank fields on the right side of the card — wider gutter so the
      // holder/IFSC values stay on one line.
      const bankTextX = qrPanelX + qrPanelW + 12;
      const bankTextW = PAD + colsBottomW - bankTextX - 10;
      const bankLines = [
        ['BANK',     template.invoice_bank_name],
        ['A/C NO.',  template.invoice_bank_account_no],
        ['IFSC',     template.invoice_bank_ifsc],
        ['HOLDER',   template.invoice_bank_account_holder],
      ].filter(([, v]) => v);
      const bankFieldH = 21;
      const bankBlockH = bankLines.length * bankFieldH;
      let bankRowY = bottomBlockTop + (bankCardH - bankBlockH) / 2;
      bankLines.forEach(([label, val]) => {
        doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.faint)
          .text(label, bankTextX, bankRowY, { width: bankTextW, characterSpacing: 0.8 });
        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink)
          .text(val, bankTextX, bankRowY + 9, { width: bankTextW, lineBreak: false, ellipsis: true });
        bankRowY += bankFieldH;
      });

      // ----- Signatory block (right column, same baseline as bank card) -----
      // Subtle dotted box around the signing area so it doesn't read as
      // accidental whitespace.
      const sigW = totalsCardW;
      const sigX = totalsCardX;
      doc.lineWidth(0.6).strokeColor(COLORS.border).dash(2, { space: 3 })
        .roundedRect(sigX, bottomBlockTop, sigW, bankCardH, 8).stroke();
      doc.undash();
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
        .text(`for ${template.invoice_company_name || 'Company'}`, sigX + 10, bottomBlockTop + 8,
          { width: sigW - 20, align: 'center' });
      const sigLineY = bottomBlockTop + bankCardH - 22;
      doc.lineWidth(0.8).strokeColor(COLORS.faint)
        .moveTo(sigX + 24, sigLineY).lineTo(sigX + sigW - 24, sigLineY).stroke();
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(10)
        .text('Authorized Signatory', sigX + 10, sigLineY + 4, { width: sigW - 20, align: 'center' });

      // ===== Footer =====
      doc.lineWidth(0.5).strokeColor(COLORS.border)
        .moveTo(PAD, footerY - 8).lineTo(RIGHT, footerY - 8).stroke();
      doc.fillColor(COLORS.faint).font('Helvetica-Oblique').fontSize(7.5)
        .text(
          'This is a computer-generated invoice. No signature required when issued through the FCC ERP.',
          PAD, footerY - 4, { width: W - 2 * PAD, align: 'center' },
        );

      // ===== Page 2: Claims Summary (landscape, so many columns fit) =====
      const claimLines = (invoice.lineItems || []).filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId);
      if (claimLines.length) {
        // Columns are operator-configurable via Settings → invoice_summary_columns.
        const selectedKeys = parseSelected(template.invoice_summary_columns);
        const pickedFields = resolveColumns(selectedKeys);
        // Preserve operator ordering.
        const orderedFields = selectedKeys
          .map((k) => pickedFields.find((f) => f.key === k))
          .filter(Boolean);
        const safeFields = orderedFields.length
          ? orderedFields
          : resolveColumns(['patientName', 'doctorName', 'insuranceCompany', 'ccnNo', 'tpa', 'dateOfDischarge', 'finalApprovalDate', 'tpaFee']);

        // Landscape A4 → 842 × 595. Way more horizontal room for the summary.
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
        const LW = doc.page.width;
        const LH = doc.page.height;
        const LPAD = 28;
        const LRIGHT = LW - LPAD;

        const tableX = LPAD;
        const tableW = LW - 2 * LPAD;
        const srW = 26;
        const remainingW = tableW - srW;
        const totalFlex = safeFields.reduce((s, f) => s + (Number(f.flex) || 1), 0) || 1;

        const buildCols = (xStart) => {
          const cols = [{ key: '__sr', label: '#', x: xStart, w: srW, align: 'center', isAmount: false }];
          let cx = xStart + srW;
          safeFields.forEach((f) => {
            const w = Math.max(54, Math.floor((remainingW * (Number(f.flex) || 1)) / totalFlex));
            cols.push({ key: f.key, label: f.label, x: cx, w, align: f.align || 'left', isAmount: !!f.isAmount, field: f });
            cx += w;
          });
          // Stretch the final column to the right edge to absorb any rounding gap.
          const last = cols[cols.length - 1];
          last.w = (tableX + tableW) - last.x;
          return cols;
        };

        const drawHeaderBand = (cy) => {
          const cols = buildCols(tableX);
          doc.rect(tableX, cy, tableW, 26).fill(COLORS.primary50);
          doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(8);
          cols.forEach((c) =>
            doc.text(c.label.toUpperCase(), c.x + 4, cy + 9, {
              width: c.w - 8,
              align: c.align,
              characterSpacing: 0.4,
              lineBreak: false,
              ellipsis: true,
            }),
          );
          return { cols, nextY: cy + 26 };
        };

        // Top accent
        doc.rect(0, 0, LW, 6).fill(COLORS.primary600);
        let cy = 22;

        // Header line
        doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16)
          .text('Claims Summary', LPAD, cy);
        const monthLbl = invoice.month
          ? new Date(invoice.month).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
          : '';
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
          .text(
            `Invoice ${invoice.invoiceNumber || 'Draft'}${monthLbl ? '  ·  ' + monthLbl : ''}  ·  ${claimLines.length} claim${claimLines.length === 1 ? '' : 's'}`,
            LPAD, cy, { width: LW - 2 * LPAD, align: 'right' },
          );
        cy += 30;

        let header = drawHeaderBand(cy);
        let cols = header.cols;
        cy = header.nextY;

        const sumRowH = 20;
        const totals = {};
        safeFields.forEach((f) => { if (f.isAmount) totals[f.key] = 0; });

        // Description fallback so rows still show patient / CCN if the underlying
        // claim record was deleted (line items keep claimId as a string but the
        // FK isn't enforced — line.description always has "TPA Desk — NAME (CCN xxx)").
        const parseDescription = (desc) => {
          if (!desc) return { patient: '', ccn: '' };
          const m = desc.match(/[—-]\s*(.+?)\s*(?:\(CCN\s*(.+?)\))?$/);
          return { patient: (m?.[1] || desc).trim(), ccn: (m?.[2] || '').trim() };
        };

        claimLines.forEach((line, i) => {
          // Leave room for the bottom rule + totals band (~ 50px) before page-breaking.
          if (cy > LH - 70) {
            doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
            doc.rect(0, 0, LW, 6).fill(COLORS.primary600);
            cy = LPAD;
            header = drawHeaderBand(cy);
            cols = header.cols;
            cy = header.nextY;
          }
          if (i % 2 === 1) doc.rect(tableX, cy, tableW, sumRowH).fill(COLORS.alt);

          const claim = claimsById.get(line.claimId);
          const fallback = claim ? null : parseDescription(line.description);

          cols.forEach((c) => {
            let text;
            if (c.key === '__sr') {
              text = String(i + 1);
            } else if (c.key === 'tpaFee') {
              text = formatINR(line.amount);
              totals.tpaFee = (totals.tpaFee || 0) + (Number(line.amount) || 0);
            } else {
              const f = c.field;
              let raw;
              if (claim && f && typeof f.get === 'function') {
                raw = f.get(claim);
              } else if (!claim && fallback && c.key === 'patientName') {
                raw = fallback.patient || '-';
              } else if (!claim && fallback && c.key === 'ccnNo') {
                raw = fallback.ccn || '-';
              } else {
                raw = '-';
              }
              if (f && f.isAmount) {
                const num = Number(raw) || 0;
                totals[c.key] = (totals[c.key] || 0) + num;
                text = formatINR(num);
              } else {
                text = (raw === '' || raw == null) ? '-' : String(raw);
              }
            }
            const bold = c.key === 'patientName' || c.key === 'tpaFee';
            doc.fillColor(COLORS.ink)
              .font(bold ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(8.5)
              .text(text, c.x + 4, cy + 6, {
                width: c.w - 8,
                align: c.align,
                ellipsis: true,
                lineBreak: false,
              });
          });

          cy += sumRowH;
        });

        // Bottom rule
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .moveTo(tableX, cy).lineTo(tableX + tableW, cy).stroke();
        cy += 8;

        // Totals band — sums every amount column.
        if (cy > LH - 36) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
          doc.rect(0, 0, LW, 6).fill(COLORS.primary600);
          cy = LPAD;
        }
        doc.rect(tableX, cy, tableW, 28).fill(COLORS.primary600);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
          .text(`Total — ${claimLines.length} claim${claimLines.length === 1 ? '' : 's'}`, tableX + 12, cy + 9, { lineBreak: false });
        cols.forEach((c) => {
          if (c.isAmount && totals[c.key] != null) {
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10.5)
              .text(formatINR(totals[c.key]), c.x + 4, cy + 9, {
                width: c.w - 8,
                align: 'right',
                lineBreak: false,
              });
          }
        });
        // Keep LRIGHT referenced for symmetry / future use.
        void LRIGHT;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
};

module.exports = renderInvoicePdf;
