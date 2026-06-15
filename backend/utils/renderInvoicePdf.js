const PDFDocument = require('pdfkit');

const formatINR = (n) => {
  const v = Math.round(Number(n) || 0);
  return 'Rs. ' + v.toLocaleString('en-IN');
};

const formatDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatMonth = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk Fees',
  service_fixed: 'Fixed Services',
  service_percentage: 'Variable Services',
  adjustment: 'Adjustments',
};

const renderInvoicePdf = (invoice, hospital) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).font('Helvetica-Bold').text('FCC Tax Invoice', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').text('First Care Consultancy, Surat', { align: 'center' });
      doc.moveDown();

      // Invoice meta
      const metaY = doc.y;
      doc.fontSize(10).font('Helvetica-Bold').text('Invoice No.', 50, metaY);
      doc.font('Helvetica').text(invoice.invoiceNumber || `DRAFT-${invoice.id.slice(0, 8)}`, 130, metaY);

      doc.font('Helvetica-Bold').text('Status', 320, metaY);
      doc.font('Helvetica').text(String(invoice.status || '').toUpperCase(), 400, metaY);

      doc.font('Helvetica-Bold').text('Month', 50, metaY + 18);
      doc.font('Helvetica').text(formatMonth(invoice.month), 130, metaY + 18);

      doc.font('Helvetica-Bold').text('Issued At', 320, metaY + 18);
      doc.font('Helvetica').text(formatDate(invoice.issuedAt), 400, metaY + 18);

      doc.font('Helvetica-Bold').text('Due Date', 50, metaY + 36);
      doc.font('Helvetica').text(formatDate(invoice.dueDate), 130, metaY + 36);

      doc.moveDown(3);

      // Hospital block
      doc.font('Helvetica-Bold').fontSize(11).text('Bill To:');
      doc.font('Helvetica').fontSize(10);
      doc.text(hospital.name);
      if (hospital.address) doc.text(hospital.address);
      const cityLine = [hospital.city, hospital.state, hospital.pincode].filter(Boolean).join(', ');
      if (cityLine) doc.text(cityLine);
      if (hospital.phone) doc.text('Ph: ' + hospital.phone);
      doc.moveDown();

      // Line item table
      const grouped = (invoice.lineItems || []).reduce((acc, l) => {
        const k = l.lineType;
        (acc[k] = acc[k] || []).push(l);
        return acc;
      }, {});

      const tableX = 50;
      const colDesc = 50;
      const colAmt = 480;

      const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Description', colDesc, doc.y);
        doc.text('Amount', colAmt, doc.y - 12, { width: 80, align: 'right' });
        doc.moveTo(tableX, doc.y + 4).lineTo(560, doc.y + 4).stroke();
        doc.moveDown(0.6);
      };

      drawHeader();

      const orderedTypes = ['claim_tpa_desk', 'service_fixed', 'service_percentage', 'adjustment'];
      for (const type of orderedTypes) {
        const rows = grouped[type];
        if (!rows || !rows.length) continue;
        doc.font('Helvetica-Bold').fontSize(10).text(LINE_TYPE_LABEL[type] || type, colDesc, doc.y);
        doc.moveDown(0.3);
        for (const r of rows) {
          if (doc.y > 720) doc.addPage();
          doc.font('Helvetica').fontSize(9);
          const startY = doc.y;
          doc.text(r.description, colDesc + 10, startY, { width: 410 });
          doc.text(formatINR(r.amount), colAmt, startY, { width: 80, align: 'right' });
          doc.moveDown(0.4);
        }
        doc.moveDown(0.3);
      }

      doc.moveTo(tableX, doc.y).lineTo(560, doc.y).stroke();
      doc.moveDown(0.5);

      // Totals
      const drawTotal = (label, value, bold = false) => {
        if (doc.y > 740) doc.addPage();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        doc.text(label, 350, doc.y, { width: 130, align: 'right', continued: false });
        doc.text(formatINR(value), colAmt, doc.y - 12, { width: 80, align: 'right' });
        doc.moveDown(0.25);
      };

      drawTotal('Subtotal — TPA Desk', invoice.subtotalTpaDesk);
      drawTotal('Subtotal — Services', invoice.subtotalServices);
      if (invoice.subtotalAdjust !== 0) drawTotal('Adjustments', invoice.subtotalAdjust);
      drawTotal('Gross', invoice.gross, true);
      if (invoice.gstAmount) drawTotal(`GST (${invoice.gstRate}%)`, invoice.gstAmount);
      if (invoice.tdsAmount) drawTotal(`TDS (${invoice.tdsRate}%)`, -invoice.tdsAmount);
      drawTotal('Net Total', invoice.netTotal, true);
      if (invoice.previousBalance) drawTotal('Previous Balance', invoice.previousBalance);
      drawTotal('Grand Total', invoice.grandTotal, true);
      if (invoice.amountPaid) {
        drawTotal('Amount Paid', invoice.amountPaid);
        drawTotal('Amount Pending', invoice.amountPending, true);
      }

      // Notes + footer
      doc.moveDown(2);
      if (invoice.notes) {
        doc.font('Helvetica-Bold').fontSize(10).text('Notes:', 50, doc.y);
        doc.font('Helvetica').fontSize(9).text(invoice.notes, 50, doc.y, { width: 510 });
        doc.moveDown();
      }

      doc.moveTo(50, 780).lineTo(560, 780).stroke();
      doc.font('Helvetica-Oblique').fontSize(8).text(
        'This is a computer-generated invoice. No signature required.',
        50, 785, { width: 510, align: 'center' },
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });

module.exports = renderInvoicePdf;
