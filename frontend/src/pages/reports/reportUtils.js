// Shared helpers for the Phase 2.6 report pages.
import * as XLSX from 'xlsx';

export const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export const todayIso = () => new Date().toISOString().slice(0, 10);

export const monthsAgoIso = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

// Quick filter-bar default: last 6 months → today.
export const defaultRange = () => ({ from: monthsAgoIso(5), to: todayIso() });

// Simple SVG bar chart used by Sales/Expenses/Profit reports.
// Avoids pulling in a chart library while still rendering readable bars.
export const BarChart = ({ rows = [], keyField = 'key', labelField = 'label', valueFields = ['value'], height = 220, colors }) => {
  if (!rows.length) {
    return (
      <div className="text-center text-sm text-gray-400 py-8">No data in this range</div>
    );
  }
  const defaultColors = colors || ['#1d4ed8', '#dc2626', '#16a34a', '#f59e0b'];
  const maxVal = Math.max(1, ...rows.flatMap((r) => valueFields.map((f) => Math.abs(Number(r[f]) || 0))));
  const barWidth = Math.max(20, Math.floor(600 / Math.max(rows.length, 1)));
  const chartWidth = Math.max(600, rows.length * (barWidth + 8) + 60);
  const groupWidth = barWidth * valueFields.length + 6;
  return (
    <div className="overflow-x-auto">
      <svg width={chartWidth} height={height + 40} className="block">
        {/* Y axis baseline */}
        <line x1="40" y1={height} x2={chartWidth - 10} y2={height} stroke="#e5e7eb" strokeWidth="1" />
        {rows.map((r, i) => {
          const xBase = 50 + i * (groupWidth + 14);
          return (
            <g key={r[keyField] || i}>
              {valueFields.map((f, fi) => {
                const v = Number(r[f]) || 0;
                const h = (Math.abs(v) / maxVal) * (height - 20);
                const y = v >= 0 ? height - h : height;
                return (
                  <rect
                    key={f}
                    x={xBase + fi * (barWidth + 2)}
                    y={y}
                    width={barWidth - 2}
                    height={Math.max(2, h)}
                    fill={defaultColors[fi % defaultColors.length]}
                    rx="2"
                  />
                );
              })}
              <text x={xBase + groupWidth / 2} y={height + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
                {r[labelField]}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 mt-2 text-xs">
        {valueFields.map((f, i) => (
          <div key={f} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: defaultColors[i % defaultColors.length] }} />
            <span className="text-gray-600 capitalize">{f}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Export rows to xlsx using the dep that already ships with the app.
export const exportRowsXlsx = (rows, columns, filename) => {
  const data = rows.map((r) => {
    const out = {};
    for (const c of columns) out[c.label] = typeof c.format === 'function' ? c.format(r[c.field], r) : r[c.field];
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `${filename || 'report'}.xlsx`);
};
