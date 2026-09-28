import { formatDate, formatMonthLabel, formatCurrency } from './format';

// Resolve the human name for a direct-patient / party invoice.
// Hospital invoices return null (they render `hospital.name` instead).
// Direct-patient bills carry the name on `partyName` (imported party bills)
// or embedded in the first TPA-desk line's description ("… — <Patient> (CCN…)").
export const patientNameForInvoice = (inv) => {
  if (!inv?.isDirectPatient) return null;
  if (inv.partyName) return inv.partyName;
  const firstTpa = (inv.lineItems || []).find((l) => l.lineType === 'claim_tpa_desk');
  const desc = firstTpa?.description || '';
  let afterSep = '';
  if (desc.includes('—')) {
    const parts = desc.split(/\s*—\s*/);
    afterSep = parts.slice(1).join(' — ');
  } else {
    const idx = desc.lastIndexOf(' - ');
    afterSep = idx >= 0 ? desc.slice(idx + 3) : '';
  }
  const name = afterSep.replace(/\s*\(CCN[^)]*\)\s*$/, '').trim();
  return name || 'Direct Patient';
};

// Counterparty name for any invoice — hospital name for hospital invoices,
// patient/party name for direct-patient invoices. Returns '' when unknown.
export const invoiceDisplayName = (inv) =>
  inv?.hospital?.name || patientNameForInvoice(inv) || inv?.partyName || '';

// Overdue = issued/partially-paid, still has money outstanding, and past its
// due date. Same rule used everywhere an "OVERDUE" badge is shown — kept here
// once so the reminder action and the badge can't drift apart.
export const isInvoiceOverdue = (inv) =>
  !!inv
  && (inv.status === 'issued' || inv.status === 'partially_paid')
  && (inv.amountPending || 0) > 0
  && !!inv.dueDate
  && new Date(inv.dueDate) < new Date();

// Fills {{placeholder}} tokens in the admin-configured reminder template
// (Settings → Payment Reminder) with this invoice's data. Unknown/blank
// placeholders resolve to '' rather than being left in the text.
export const buildReminderMessage = (template, inv, companyName) => {
  const values = {
    hospitalName: invoiceDisplayName(inv) || '—',
    invoiceNumber: inv?.invoiceNumber || `Draft-${String(inv?._id || '').slice(0, 8)}`,
    invoiceDate: formatDate(inv?.invoiceDate),
    dueDate: formatDate(inv?.dueDate),
    month: formatMonthLabel(inv?.month),
    grandTotal: formatCurrency((inv?.grandTotal || 0) - (inv?.previousBalance || 0)),
    amountPaid: formatCurrency(inv?.amountPaid || 0),
    amountPending: formatCurrency(inv?.amountPending || 0),
    companyName: companyName || 'First Care Consultancy',
  };
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (values[key] ?? ''));
};
