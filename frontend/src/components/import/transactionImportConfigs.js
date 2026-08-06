// Entity-specific configs for the generic TransactionImportModal. Each builder
// closes over the reference data the list page already has loaded, so the modal
// stays a pure, data-agnostic component.
import { importExpensesAPI, importCashBankAPI, importAccountEntriesAPI, importInvoicesAPI } from '../../services/api';
import { norm, cleanNum, parseDateLoose } from './importHelpers';

const MODES = ['cash', 'bank', 'upi'];
const INVOICE_STATUSES = ['draft', 'issued', 'partially_paid', 'paid'];

// Month cell → truthy if parseable as YYYY-MM / MM/YYYY / full date.
const parseMonthLoose = (val) => {
  if (val === undefined || val === null || String(val).trim() === '') return null;
  const s = String(val).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) { const mo = +m[2]; return mo >= 1 && mo <= 12 ? new Date(Date.UTC(+m[1], mo - 1, 1)) : null; }
  m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) { const mo = +m[1]; return mo >= 1 && mo <= 12 ? new Date(Date.UTC(+m[2], mo - 1, 1)) : null; }
  return parseDateLoose(s);
};
const DIRECTION_SYNONYMS = {
  in: 'in', received: 'in', receipt: 'in', credit: 'in', deposit: 'in',
  out: 'out', paid: 'out', payment: 'out', debit: 'out', withdrawal: 'out',
};

// ── Expenses ───────────────────────────────────────────────────────────────
export const expenseImportConfig = ({ categories = [], references = [] }) => {
  const activeCategories = categories.filter((c) => c.isActive);
  const catMap = new Map();
  activeCategories.forEach((c) => { catMap.set(norm(c.label), c); if (!catMap.has(norm(c.slug))) catMap.set(norm(c.slug), c); });
  const refSet = new Set(references.map((r) => norm(r.name)));
  const exCat = activeCategories[0]?.label || 'Office Rent';
  const exCat2 = activeCategories[1]?.label || exCat;
  const exRef = references[0]?.name || '';

  return {
    title: 'Import Expenses',
    entityLabel: 'expense',
    sheetName: 'Expenses',
    templateName: 'expense-import-template.xlsx',
    dateKeys: ['date'],
    columns: [
      { key: 'date', label: 'Date *', width: 14, required: true, note: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'category', label: 'Category *', width: 24, required: true, note: 'Must match a category (see Categories sheet)' },
      { key: 'amount', label: 'Amount *', width: 14, required: true, note: 'Numbers only, no ₹ or commas. Negative for reversals.' },
      { key: 'partyName', label: 'Party Name', width: 22, note: 'Vendor / payee (optional)' },
      { key: 'reference', label: 'Reference', width: 22, note: 'Optional — must match a reference (see References sheet)' },
      { key: 'notes', label: 'Notes', width: 30, note: 'Optional' },
    ],
    sampleRows: [
      { date: '2025-03-12', category: exCat, amount: 15000, partyName: 'Reliance Realty', reference: '', notes: 'Office rent' },
      { date: '2025-03-15', category: exCat2, amount: 2400, partyName: 'Tata Power', reference: exRef, notes: 'Electricity bill' },
    ],
    refSheets: [
      { name: 'Categories', header: 'Category (use this in the Category column)', values: activeCategories.map((c) => c.label) },
      { name: 'References', header: 'Reference Name (use this in the Reference column)', values: references.map((r) => r.name) },
    ],
    previewColumns: [
      { key: 'date', label: 'Date' },
      { key: 'category', label: 'Category' },
      { key: 'amount', label: 'Amount', align: 'right' },
      { key: 'partyName', label: 'Party' },
    ],
    uploadAPI: (rows) => importExpensesAPI(rows),
    validateRow: (r) => {
      const issues = [];
      if (!parseDateLoose(r.date)) issues.push({ type: 'date', label: `Date ${r.date ? `invalid: "${r.date}"` : 'missing'}` });
      const catRaw = String(r.category ?? '').trim();
      if (!catRaw) issues.push({ type: 'category', label: 'Category missing' });
      else if (!catMap.get(norm(catRaw))) issues.push({ type: 'category', label: `Category not found: "${catRaw}"` });
      const amt = cleanNum(r.amount);
      if (amt === null) issues.push({ type: 'amount', label: 'Amount missing' });
      else if (Number.isNaN(amt)) issues.push({ type: 'amount', label: `Amount not a number: "${r.amount}"` });
      const refRaw = String(r.reference ?? '').trim();
      if (refRaw && !refSet.has(norm(refRaw))) issues.push({ type: 'reference', label: `Reference not found: "${refRaw}"` });
      return issues;
    },
  };
};

// ── Cash / Bank ────────────────────────────────────────────────────────────
export const cashBankImportConfig = ({ bankAccounts = [] }) => {
  const bankDisplay = (b) => (b.accountNumber ? `${b.bankName} - ${b.accountNumber}` : b.bankName);
  const bankSet = new Set();
  bankAccounts.forEach((b) => {
    bankSet.add(norm(b.bankName));
    if (b.accountNumber) { bankSet.add(norm(b.accountNumber)); bankSet.add(norm(bankDisplay(b))); }
  });
  const hasDefaultBank = bankAccounts.some((b) => b.isDefault) || bankAccounts.length === 1;
  const exBank = bankAccounts[0] ? bankDisplay(bankAccounts[0]) : '';

  return {
    title: 'Import Cash / Bank Entries',
    entityLabel: 'entry',
    sheetName: 'CashBank',
    templateName: 'cashbank-import-template.xlsx',
    dateKeys: ['date'],
    columns: [
      { key: 'date', label: 'Date *', width: 14, required: true, note: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'direction', label: 'Direction *', width: 12, required: true, note: 'in = money received, out = money paid' },
      { key: 'mode', label: 'Mode *', width: 10, required: true, note: 'cash / bank / upi' },
      { key: 'amount', label: 'Amount *', width: 14, required: true, note: 'Positive number only' },
      { key: 'bankAccount', label: 'Bank Account', width: 26, note: 'Required for bank/upi (see Bank Accounts sheet). Blank uses the default.' },
      { key: 'utrNumber', label: 'UTR Number', width: 16, note: 'Optional' },
      { key: 'chequeNumber', label: 'Cheque Number', width: 16, note: 'Optional' },
      { key: 'notes', label: 'Notes', width: 28, note: 'Optional' },
    ],
    sampleRows: [
      { date: '2025-03-12', direction: 'in', mode: 'cash', amount: 5000, bankAccount: '', utrNumber: '', chequeNumber: '', notes: 'Cash received' },
      { date: '2025-03-13', direction: 'out', mode: 'bank', amount: 12000, bankAccount: exBank, utrNumber: 'UTR123456', chequeNumber: '', notes: 'Vendor payment' },
    ],
    refSheets: [
      { name: 'Bank Accounts', header: 'Bank Account (use this in the Bank Account column)', values: bankAccounts.map(bankDisplay) },
    ],
    previewColumns: [
      { key: 'date', label: 'Date' },
      { key: 'direction', label: 'Direction' },
      { key: 'mode', label: 'Mode' },
      { key: 'amount', label: 'Amount', align: 'right' },
      { key: 'bankAccount', label: 'Bank Account' },
    ],
    uploadAPI: (rows) => importCashBankAPI(rows),
    validateRow: (r) => {
      const issues = [];
      if (!parseDateLoose(r.date)) issues.push({ type: 'date', label: `Date ${r.date ? `invalid: "${r.date}"` : 'missing'}` });
      const dir = DIRECTION_SYNONYMS[norm(r.direction)] || norm(r.direction);
      if (!['in', 'out'].includes(dir)) issues.push({ type: 'direction', label: `Direction must be in/out: "${r.direction ?? ''}"` });
      const mode = norm(r.mode);
      if (!MODES.includes(mode)) issues.push({ type: 'mode', label: `Mode must be cash/bank/upi: "${r.mode ?? ''}"` });
      const amt = cleanNum(r.amount);
      if (amt === null) issues.push({ type: 'amount', label: 'Amount missing' });
      else if (Number.isNaN(amt) || amt <= 0) issues.push({ type: 'amount', label: `Amount must be positive: "${r.amount}"` });
      if (mode === 'bank' || mode === 'upi') {
        const bankRaw = String(r.bankAccount ?? '').trim();
        if (bankRaw) { if (!bankSet.has(norm(bankRaw))) issues.push({ type: 'bank', label: `Bank account not found: "${bankRaw}"` }); }
        else if (!hasDefaultBank) issues.push({ type: 'bank', label: 'Bank/UPI needs a bank account (no default set)' });
      }
      return issues;
    },
  };
};

// ── Account Entries ────────────────────────────────────────────────────────
export const accountEntryImportConfig = () => ({
  title: 'Import Account Entries',
  entityLabel: 'entry',
  sheetName: 'AccountEntries',
  templateName: 'account-entries-import-template.xlsx',
  dateKeys: ['date'],
  columns: [
    { key: 'date', label: 'Date *', width: 14, required: true, note: 'YYYY-MM-DD or DD/MM/YYYY' },
    { key: 'type', label: 'Type *', width: 12, required: true, note: 'general or contra' },
    { key: 'debit', label: 'Debit', width: 12, note: 'general only — numbers only' },
    { key: 'credit', label: 'Credit', width: 12, note: 'general only — numbers only' },
    { key: 'fromMode', label: 'From Mode', width: 12, note: 'contra only — cash/bank/upi' },
    { key: 'toMode', label: 'To Mode', width: 12, note: 'contra only — cash/bank/upi' },
    { key: 'amount', label: 'Amount', width: 14, note: 'contra only — positive number' },
    { key: 'remarks', label: 'Remarks', width: 28, note: 'Optional' },
  ],
  sampleRows: [
    { date: '2025-03-12', type: 'general', debit: 5000, credit: '', fromMode: '', toMode: '', amount: '', remarks: 'Opening cash balance' },
    { date: '2025-03-13', type: 'contra', debit: '', credit: '', fromMode: 'cash', toMode: 'bank', amount: 10000, remarks: 'Cash deposited to bank' },
  ],
  previewColumns: [
    { key: 'date', label: 'Date' },
    { key: 'type', label: 'Type' },
    { key: 'debit', label: 'Debit', align: 'right' },
    { key: 'credit', label: 'Credit', align: 'right' },
    { key: 'transfer', label: 'Transfer', render: (r) => (norm(r.type) === 'contra' ? `${norm(r.fromMode) || '?'} → ${norm(r.toMode) || '?'}` : '-') },
    { key: 'amount', label: 'Amount', align: 'right' },
  ],
  uploadAPI: (rows) => importAccountEntriesAPI(rows),
  validateRow: (r) => {
    const issues = [];
    if (!parseDateLoose(r.date)) issues.push({ type: 'date', label: `Date ${r.date ? `invalid: "${r.date}"` : 'missing'}` });
    const type = norm(r.type ?? r.entryType);
    if (!['general', 'contra'].includes(type)) { issues.push({ type: 'type', label: `Type must be general/contra: "${r.type ?? ''}"` }); return issues; }
    if (type === 'general') {
      const d = cleanNum(r.debit);
      const c = cleanNum(r.credit);
      if (Number.isNaN(d) || Number.isNaN(c)) issues.push({ type: 'amount', label: 'Debit/Credit must be numbers' });
      else if ((d || 0) <= 0 && (c || 0) <= 0) issues.push({ type: 'amount', label: 'Debit or Credit is required' });
      else if ((d || 0) < 0 || (c || 0) < 0) issues.push({ type: 'amount', label: 'Debit/Credit must be non-negative' });
    } else {
      const fm = norm(r.fromMode);
      const tm = norm(r.toMode);
      if (!MODES.includes(fm) || !MODES.includes(tm)) issues.push({ type: 'mode', label: 'From/To Mode must be cash/bank/upi' });
      else if (fm === tm) issues.push({ type: 'mode', label: 'From and To Mode must differ' });
      const a = cleanNum(r.amount);
      if (a === null || Number.isNaN(a) || a <= 0) issues.push({ type: 'amount', label: 'Contra amount must be positive' });
    }
    return issues;
  },
});

// ── Invoices (legacy / opening-balance) ────────────────────────────────────
export const invoiceImportConfig = ({ hospitals = [] }) => {
  const hospSet = new Set(hospitals.map((h) => norm(h.name)));
  const exHosp = hospitals[0]?.name || 'City Hospital';
  const exHosp2 = hospitals[1]?.name || exHosp;

  return {
    title: 'Import Invoices',
    entityLabel: 'invoice',
    sheetName: 'Invoices',
    templateName: 'invoice-import-template.xlsx',
    dateKeys: ['month'],
    columns: [
      { key: 'invoiceNumber', label: 'Invoice No', width: 16, note: 'Optional — must be unique. Blank leaves it unnumbered.' },
      { key: 'hospital', label: 'Hospital *', width: 26, required: true, note: 'Must match a hospital (see Hospitals sheet)' },
      { key: 'month', label: 'Month *', width: 12, required: true, note: 'YYYY-MM (e.g. 2025-03)' },
      { key: 'status', label: 'Status', width: 14, note: 'issued / paid / partially_paid / draft. Blank = auto from Amount Paid.' },
      { key: 'grandTotal', label: 'Grand Total *', width: 14, required: true, note: 'Numbers only, no ₹ or commas' },
      { key: 'amountPaid', label: 'Amount Paid', width: 14, note: 'Optional — default 0. Cannot exceed Grand Total.' },
      { key: 'notes', label: 'Notes', width: 28, note: 'Optional — becomes the line-item description' },
    ],
    sampleRows: [
      { invoiceNumber: 'INV-1001', hospital: exHosp, month: '2025-03', status: 'partially_paid', grandTotal: 145000, amountPaid: 100000, notes: 'Opening balance (imported)' },
      { invoiceNumber: 'INV-1002', hospital: exHosp2, month: '2025-04', status: 'paid', grandTotal: 62000, amountPaid: 62000, notes: '' },
    ],
    refSheets: [
      { name: 'Hospitals', header: 'Hospital Name (use this in the Hospital column)', values: hospitals.map((h) => h.name) },
    ],
    previewColumns: [
      { key: 'invoiceNumber', label: 'Invoice No' },
      { key: 'hospital', label: 'Hospital' },
      { key: 'month', label: 'Month' },
      { key: 'grandTotal', label: 'Grand Total', align: 'right' },
      { key: 'amountPaid', label: 'Amount Paid', align: 'right' },
      { key: 'status', label: 'Status' },
    ],
    uploadAPI: (rows) => importInvoicesAPI(rows),
    validateRow: (r) => {
      const issues = [];
      const hospRaw = String(r.hospital ?? '').trim();
      if (!hospRaw) issues.push({ type: 'hospital', label: 'Hospital missing' });
      else if (!hospSet.has(norm(hospRaw))) issues.push({ type: 'hospital', label: `Hospital not found: "${hospRaw}"` });
      if (!parseMonthLoose(r.month)) issues.push({ type: 'month', label: `Month ${r.month ? `invalid: "${r.month}"` : 'missing'}` });
      const gt = cleanNum(r.grandTotal);
      if (gt === null) issues.push({ type: 'amount', label: 'Grand Total missing' });
      else if (Number.isNaN(gt) || gt < 0) issues.push({ type: 'amount', label: `Grand Total invalid: "${r.grandTotal}"` });
      const paid = cleanNum(r.amountPaid);
      if (paid !== null) {
        if (Number.isNaN(paid) || paid < 0) issues.push({ type: 'amount', label: `Amount Paid invalid: "${r.amountPaid}"` });
        else if (gt !== null && !Number.isNaN(gt) && paid > gt) issues.push({ type: 'amount', label: 'Amount Paid exceeds Grand Total' });
      }
      const status = norm(r.status);
      if (status && !INVOICE_STATUSES.includes(status)) issues.push({ type: 'status', label: `Status invalid: "${r.status}"` });
      return issues;
    },
  };
};
