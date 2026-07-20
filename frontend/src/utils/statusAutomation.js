// Resolve the claim status that a workflow action should set, from the per-
// insurer / per-TPA "status automation" rules. Rules match by claim type; TPA
// rules take precedence over the insurance company's. Returns null when no rule
// matches (caller falls back to the default status).

const matchRule = (rules, claimType) => {
  if (!Array.isArray(rules)) return null;
  const hit = rules.find(
    r => r && Array.isArray(r.claimTypes) && r.claimTypes.includes(claimType) && r.status
  );
  return hit ? hit.status : null;
};

export const resolveAutomationStatus = (claim) => {
  if (!claim || !claim.claimType) return null;
  return (
    matchRule(claim.tpa?.statusAutomation, claim.claimType) ||
    matchRule(claim.insuranceCompany?.statusAutomation, claim.claimType) ||
    null
  );
};

export default resolveAutomationStatus;
