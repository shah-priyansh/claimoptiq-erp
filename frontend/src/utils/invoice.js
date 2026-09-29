import { formatDate, formatCurrency } from './format';

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

// Fills {{placeholder}} tokens in the reminder template with EVERY open
// invoice for one party — {{invoiceListBlock}} becomes a bullet per invoice
// (number, date, pending amount) and {{totalOutstanding}} is their sum. Used
// so a hospital with several pending invoices gets a single reminder with a
// party-wise total instead of one message per invoice. `invoices` should
// already be filtered to open/pending ones (e.g. via `status: '__open'`);
// falls back to `fallbackInvoice` alone if the list comes back empty (invoice
// has no partyId yet, or its dues were cleared between opening and sending).
export const buildPartyReminderMessage = (template, invoices, fallbackInvoice, companyName, companyPhone) => {
  const list = invoices && invoices.length ? invoices : [fallbackInvoice].filter(Boolean);
  const totalOutstanding = list.reduce((sum, inv) => sum + (Number(inv?.amountPending) || 0), 0);
  const invoiceListBlock = list
    .map((inv) => `• Invoice No: ${inv?.invoiceNumber || `Draft-${String(inv?._id || '').slice(0, 8)}`} | Date: ${formatDate(inv?.invoiceDate)} | Amount: ${formatCurrency(inv?.amountPending || 0)}`)
    .join('\n\n');
  const values = {
    hospitalName: invoiceDisplayName(list[0] || fallbackInvoice) || '—',
    invoiceListBlock,
    totalOutstanding: formatCurrency(totalOutstanding),
    companyName: companyName || 'First Care Consultancy',
    companyPhone: companyPhone || '',
  };
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => (values[key] ?? ''));
};
