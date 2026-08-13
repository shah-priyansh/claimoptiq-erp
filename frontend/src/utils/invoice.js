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
