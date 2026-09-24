// Renders the Hospital Final Bill as a printable A4 PDF, laid out like the
// operator's paper IPD bill format: hospital header, patient/bill meta grid,
// itemized table, totals block, amount in words, signatory line.
const PDFDocument = require('pdfkit');
const amountInWords = require('./amountInWords');
const { round2 } = require('./money');

const COLORS = {
  primary600: '#1d4ed8',
  primary50:  '#eff6ff',
  ink:        '#111827',
  body:       '#374151',
  muted:      '#6b7280',
  faint:      '#9ca3af',
  border:     '#e5e7eb',
  alt:        '#f9fafb',
};

const formatINR = (n) => {
  const v = round2(Number(n) || 0);
  const sign = v < 0 ? '- ' : '';
  return sign + 'Rs. ' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// DD/MM/YYYY, per spec.
const formatDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// "14:05" -> "14:05" (validated passthrough, 24h). Blank/invalid drops the time.
const formatTime = (hhmm) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm || '') ? hhmm : '');

// "DD/MM/YYYY | HH:MM", per spec. Falls back to just the date if no time is set.
const formatDateTime = (d, hhmm) => {
  const date = formatDate(d);
  if (date === '-') return '-';
  const time = formatTime(hhmm);
  return time ? `${date} | ${time}` : date;
};

const totalDays = (admit, discharge) => {
  if (!admit || !discharge) return '-';
  const a = new Date(admit), d = new Date(discharge);
  if (Number.isNaN(a.getTime()) || Number.isNaN(d.getTime())) return '-';
  const days = Math.round((d - a) / (1000 * 60 * 60 * 24)) + 1;
  return days > 0 ? String(days) : '-';
};

const renderHospitalFinalBillPdf = (claim, bill, hospital) =>
  new Promise((resolve, reject) => {
    try {
      // bufferPages so the footer (with a total page count) can be added to
      // every page in one final pass, after all content — including any
      // addPage() calls triggered by overflow — has already been laid out.
      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;
      const PAD = 40;
      const RIGHT = W - PAD;
      const contentW = W - 2 * PAD;
      let y = 30;

      doc.rect(0, 0, W, 5).fill(COLORS.primary600);
      y = 26;

      // ===== Hospital header =====
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(16)
        .text((hospital?.name || 'Hospital').toUpperCase(), PAD, y, { width: contentW, align: 'center' });
      y = doc.y + 3;
      // Many hospital records were entered with city/state already folded into
      // the free-text `address` (e.g. "...Variav, Surat, Gujarat"), so appending
      // city/state again duplicated them. Only append a piece not already
      // present in the address text.
      const addrBase = hospital?.address || '';
      const addrLower = addrBase.toLowerCase();
      const cityStatePincode = [hospital?.city, hospital?.state, hospital?.pincode]
        .filter((piece) => piece && !addrLower.includes(String(piece).toLowerCase()))
        .join(', ');
      const addrLine = [addrBase, cityStatePincode].filter(Boolean).join(', ');
      if (addrLine) {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5)
          .text(addrLine, PAD, y, { width: contentW, align: 'center' });
        y = doc.y + 2;
      }
      if (hospital?.phone) {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8.5)
          .text(`Phone: ${hospital.phone}`, PAD, y, { width: contentW, align: 'center' });
        y = doc.y + 2;
      }
      y += 10;
      doc.lineWidth(1).strokeColor(COLORS.border).moveTo(PAD, y).lineTo(RIGHT, y).stroke();
      y += 14;

      // "IPD BILL" as a small centered badge/pill rather than plain text —
      // matches the card-based visual language used for totals/words below.
      doc.font('Helvetica-Bold').fontSize(10);
      const badgeText = 'IPD BILL';
      const badgeTextW = doc.widthOfString(badgeText, { characterSpacing: 1.5 });
      const badgePadX = 14, badgeH = 20;
      const badgeW = badgeTextW + badgePadX * 2;
      const badgeX = PAD + (contentW - badgeW) / 2;
      doc.roundedRect(badgeX, y, badgeW, badgeH, badgeH / 2).fill(COLORS.primary50);
      doc.fillColor(COLORS.primary600)
        .text(badgeText, badgeX, y + 6, { width: badgeW, align: 'center', characterSpacing: 1.5 });
      y += badgeH + 14;

      // ===== Patient / bill meta grid (two columns, enclosed in a card) =====
      // One line per field ("LABEL  value"), optional fields the operator left
      // blank are skipped entirely, and the full set is interleaved into two
      // columns (not two fixed groups) so the columns stay balanced no matter
      // which optional fields happen to be present for a given bill.
      const days = totalDays(claim.dateOfAdmit, claim.dateOfDischarge);
      const allRows = [
        ['Patient Name', claim.patientName || '-'],
        ['Bill Number', bill.billNoFormatted || '-'],
        ['Credit By', claim.insuranceCompany?.name || '-'],
        ['Bill Date & Time', formatDateTime(bill.billDate, bill.billTime)],
        ...(claim.tpa?.name ? [['TPA', claim.tpa.name]] : []),
        ...(bill.opdNo ? [['OPD No.', bill.opdNo]] : []),
        ...(claim.doctorName ? [['Doctor Name', claim.doctorName]] : []),
        ...(bill.indoorNo ? [['Indoor No.', bill.indoorNo]] : []),
        ...(claim.dateOfAdmit ? [['Admission Date & Time', formatDateTime(claim.dateOfAdmit, bill.admitTime)]] : []),
        ...(bill.roomType ? [['Room Type', bill.roomType]] : []),
        ...(claim.dateOfDischarge ? [['Discharge Date & Time', formatDateTime(claim.dateOfDischarge, bill.dischargeTime)]] : []),
        ...(bill.patientDob || bill.patientAge != null
          ? [['Birth Date / Age', `${bill.patientDob ? formatDate(bill.patientDob) : '-'} / ${bill.patientAge != null ? bill.patientAge : '-'}`]]
          : []),
        ...(bill.gender ? [['Gender', bill.gender]] : []),
        ...(days !== '-' ? [['Total Days', days]] : []),
      ];
      const leftRows = allRows.filter((_, i) => i % 2 === 0);
      const rightRows = allRows.filter((_, i) => i % 2 === 1);

      const META_ROW_MIN_H = 16;
      const metaPadX = 16, metaPadTop = 14, metaPadBottom = 10;
      const colW = contentW / 2 - metaPadX - 6;
      const LABEL_W = 100;
      const valueW = colW - LABEL_W;

      // A long label ("Discharge Date & Time") or value ("IFFCO Tokio General
      // Insurance Co. Ltd.") can wrap to a second line — measure BOTH before
      // drawing so the next row (and the card background) never overlaps it.
      const measureRowH = ([label, value]) => {
        doc.font('Helvetica-Bold').fontSize(7.5);
        const labelH = doc.heightOfString(label.toUpperCase(), { width: LABEL_W, characterSpacing: 0.3 });
        doc.font('Helvetica-Bold').fontSize(9);
        const valueH = doc.heightOfString(String(value), { width: valueW });
        return Math.max(META_ROW_MIN_H, labelH + 6, valueH + 6);
      };
      const leftHeights = leftRows.map(measureRowH);
      const rightHeights = rightRows.map(measureRowH);
      const leftTotalH = leftHeights.reduce((s, h) => s + h, 0);
      const rightTotalH = rightHeights.reduce((s, h) => s + h, 0);

      const metaCardH = metaPadTop + Math.max(leftTotalH, rightTotalH) + metaPadBottom;
      doc.roundedRect(PAD, y, contentW, metaCardH, 6).fillAndStroke(COLORS.alt, COLORS.border);

      const leftX = PAD + metaPadX;
      const rightX = PAD + contentW / 2 + 6;
      const metaStartY = y + metaPadTop;

      const drawMetaRow = (x, label, value, rowY, rowH) => {
        doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(7.5)
          .text(label.toUpperCase(), x, rowY + 1, { width: LABEL_W, characterSpacing: 0.3 });
        doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
          .text(String(value), x + LABEL_W, rowY, { width: valueW });
        return rowY + rowH;
      };

      let ly = metaStartY, ry = metaStartY;
      leftRows.forEach(([label, value], i) => { ly = drawMetaRow(leftX, label, value, ly, leftHeights[i]); });
      rightRows.forEach(([label, value], i) => { ry = drawMetaRow(rightX, label, value, ry, rightHeights[i]); });
      y += metaCardH + 18;

      // ===== Line items table =====
      const cols = [
        { key: 'sr',    label: '#',           x: PAD,           w: 28,  align: 'center' },
        { key: 'name',  label: 'Particulars', x: PAD + 28,      w: 232, align: 'left'   },
        { key: 'qty',   label: 'Qty',         x: PAD + 260,     w: 65,  align: 'right'  },
        { key: 'rate',  label: 'Rate',        x: PAD + 325,     w: 95,  align: 'right'  },
        { key: 'amt',   label: 'Amount',      x: PAD + 420,     w: RIGHT - (PAD + 420), align: 'right' },
      ];
      const thH = 24;
      doc.rect(PAD, y, contentW, thH).fill(COLORS.primary50);
      doc.fillColor(COLORS.primary600).font('Helvetica-Bold').fontSize(8.5);
      cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x + 5, y + 7, { width: c.w - 10, align: c.align, characterSpacing: 0.4 }));
      y += thH;
      doc.lineWidth(0.5).strokeColor(COLORS.border).moveTo(PAD, y).lineTo(RIGHT, y).stroke();

      const items = bill.items || [];
      const ROW_MIN_H = 22;
      items.forEach((item, i) => {
        doc.font('Helvetica').fontSize(9);
        const nameH = doc.heightOfString(item.particulars || '', { width: cols[1].w - 10 });
        const rowH = Math.max(ROW_MIN_H, nameH + 12);

        if (y + rowH > H - 160) { doc.addPage(); y = 30; }
        if (i % 2 === 1) doc.rect(PAD, y, contentW, rowH).fill(COLORS.alt);

        const qtyText = item.qtyIsPercent ? `${item.qtyValue}%` : String(item.qtyValue);
        const data = { sr: String(item.srNo ?? i + 1), name: item.particulars, qty: qtyText, rate: formatINR(item.rate), amt: formatINR(item.amount) };
        cols.forEach((c) => {
          doc.fillColor(COLORS.ink)
            .font(c.key === 'amt' ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9)
            .text(data[c.key], c.x + 5, y + 6, { width: c.w - 10, align: c.align });
        });
        y += rowH;
      });
      doc.lineWidth(0.5).strokeColor(COLORS.border).moveTo(PAD, y).lineTo(RIGHT, y).stroke();
      y += 6;

      // ===== Totals block (right-aligned card) =====
      const totalsW = 240;
      const totalsX = RIGHT - totalsW;
      const drawTotalRow = (label, value, opts = {}) => {
        const { bold, band } = opts;
        const h = band ? 26 : 18;
        if (band) doc.rect(totalsX, y, totalsW, h).fill(COLORS.primary50);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor(bold ? COLORS.primary600 : COLORS.body)
          .text(label, totalsX + 10, y + (h - 10) / 2, { width: totalsW / 2, align: 'left' });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9).fillColor(COLORS.ink)
          .text(value, totalsX + totalsW / 2, y + (h - 10) / 2, { width: totalsW / 2 - 10, align: 'right' });
        y += h;
      };
      if (y > H - 160) { doc.addPage(); y = 30; }
      drawTotalRow('Total Amount', formatINR(bill.totalAmount));
      if (bill.discount) drawTotalRow('Discount', `- ${formatINR(bill.discount)}`);
      drawTotalRow('Final Bill Amount', formatINR(bill.finalAmount), { bold: true, band: true });
      y += 14;

      // ===== Amount in words =====
      const wordsText = amountInWords(bill.finalAmount);
      doc.font('Helvetica-Bold').fontSize(9.5);
      const wordsH = doc.heightOfString(wordsText, { width: contentW - 24 });
      const wordsCardH = Math.max(36, wordsH + 24);
      if (y + wordsCardH > H - 100) { doc.addPage(); y = 30; }
      doc.roundedRect(PAD, y, contentW, wordsCardH, 6).fillAndStroke(COLORS.alt, COLORS.border);
      doc.fillColor(COLORS.faint).font('Helvetica-Bold').fontSize(7.5)
        .text('TOTAL FINAL BILL AMOUNT IN WORDS', PAD + 12, y + 8, { width: contentW - 24, characterSpacing: 0.4 });
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9.5)
        .text(wordsText, PAD + 12, y + 19, { width: contentW - 24 });
      y += wordsCardH + 30;

      // ===== Signatory =====
      // Leaves clearance for the footer (added below, ~40pt tall) so the two
      // never collide on a page where the signature block lands late.
      if (y > H - 90) { doc.addPage(); y = 30; }
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9)
        .text(`For ${hospital?.name || 'Hospital'}`, PAD, y, { width: contentW, align: 'right' });
      const sigLineY = y + 40;
      doc.lineWidth(0.8).strokeColor(COLORS.faint)
        .moveTo(RIGHT - 160, sigLineY).lineTo(RIGHT, sigLineY).stroke();
      doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9)
        .text('Authorised Signatory', RIGHT - 160, sigLineY + 4, { width: 160, align: 'center' });

      // ===== Footer (every page) =====
      // Added last, in one pass over every buffered page, so the "Page NN"
      // count is correct even when item rows/totals overflowed onto extra
      // pages earlier in this render.
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(i);
        const footerY = H - 24;
        doc.lineWidth(0.5).strokeColor(COLORS.border)
          .moveTo(PAD, footerY - 8).lineTo(RIGHT, footerY - 8).stroke();
        doc.fillColor(COLORS.faint).font('Helvetica-Oblique').fontSize(7.5)
          .text('This is a computer-generated final bill and requires no physical signature.',
            PAD, footerY - 4, { width: contentW, align: 'center' });
        doc.font('Helvetica').fontSize(7.5)
          .text(`Page ${String(i + 1).padStart(2, '0')}`, PAD, footerY - 4, { width: contentW, align: 'right' });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });

module.exports = renderHospitalFinalBillPdf;
