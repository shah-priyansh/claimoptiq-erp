// Helpers for the per-insurer / per-TPA "status automation" rules.
//
// A rule set is an array of { claimTypes: string[], status: slug }. On Discharge
// Approved the app picks the first rule whose claimTypes include the claim's type
// and applies its status (TPA rules take precedence over insurance rules).

const VALID_CLAIM_TYPES = ['cashless', 'cashless_anywhere', 'reimbursement', 'grievance'];

const normClaimType = (val) =>
  String(val || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// Normalise + validate a rule set coming from the form/API or the importer.
// `validSlugs` (optional Set) drops rules whose status isn't a real claim status.
const sanitizeStatusAutomation = (value, validSlugs = null) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const status = String(raw.status || '').trim();
    if (!status) continue;
    if (validSlugs && !validSlugs.has(status)) continue;
    const types = Array.isArray(raw.claimTypes) ? raw.claimTypes : [];
    const claimTypes = [...new Set(
      types.map(normClaimType).filter(t => VALID_CLAIM_TYPES.includes(t))
    )];
    if (!claimTypes.length) continue;
    out.push({ claimTypes, status });
  }
  return out;
};

// Parse the Excel cell format into a rule set, e.g.
//   "cashless:claim_online_submitted | reimbursement,grievance:file_pending"
// Entries are separated by "|" or newlines; within an entry the claim type(s)
// come before ":" (multiple separated by "," / "+" / "&") and the status after.
const parseStatusAutomationCell = (cell, validSlugs = null) => {
  if (cell === undefined || cell === null) return [];
  const s = String(cell).trim();
  if (!s) return [];
  const rules = s.split(/[|\n]+/).map(part => {
    const idx = part.search(/[:=]/);
    if (idx === -1) return null;
    const typesPart = part.slice(0, idx);
    const status = part.slice(idx + 1).trim();
    const claimTypes = typesPart.split(/[,+&]+/).map(t => t.trim()).filter(Boolean);
    return { claimTypes, status };
  }).filter(Boolean);
  return sanitizeStatusAutomation(rules, validSlugs);
};

module.exports = { VALID_CLAIM_TYPES, sanitizeStatusAutomation, parseStatusAutomationCell };
