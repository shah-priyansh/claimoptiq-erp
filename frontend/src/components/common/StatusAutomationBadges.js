import React from 'react';
import { statusBadgeStyle, CLAIM_TYPE_LABEL, CLAIM_TYPE_OPTIONS } from '../../pages/claimstatus/ClaimStatusMaster';

// Compact, read-only view of a master's (insurer / TPA) status-automation rules.
// Renders under the company name so you can see, at a glance, which claim status
// each company auto-sets on Discharge Approved. Rules that map every claim type to
// the same status collapse into a single pill; per-type rules show the types.
const StatusAutomationBadges = ({ rules, claimStatuses = [] }) => {
  const valid = (Array.isArray(rules) ? rules : []).filter(
    (r) => r && Array.isArray(r.claimTypes) && r.claimTypes.length && r.status
  );
  if (!valid.length) return null;

  // Group the claim types by the status they resolve to, so a common
  // "all types → X" config renders as one pill instead of four.
  const byStatus = new Map();
  valid.forEach((r) => {
    const set = byStatus.get(r.status) || new Set();
    r.claimTypes.forEach((t) => set.add(t));
    byStatus.set(r.status, set);
  });

  const allTypes = CLAIM_TYPE_OPTIONS.map((o) => o.value);
  const meta = (slug) => claimStatuses.find((s) => s.slug === slug);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {[...byStatus.entries()].map(([slug, typeSet]) => {
        const m = meta(slug);
        const coversAll = allTypes.every((t) => typeSet.has(t));
        const prefix = coversAll
          ? null
          : allTypes.filter((t) => typeSet.has(t)).map((t) => CLAIM_TYPE_LABEL[t] || t).join(', ');
        return (
          <span key={slug} className="inline-flex items-center gap-1 text-[10px]">
            {prefix && (
              <>
                <span className="text-gray-400 font-medium">{prefix}</span>
                <span className="text-gray-300">→</span>
              </>
            )}
            <span className="px-1.5 py-0.5 rounded-full font-semibold capitalize" style={statusBadgeStyle(m?.color)}>
              {m?.label || slug.replace(/_/g, ' ')}
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default StatusAutomationBadges;
