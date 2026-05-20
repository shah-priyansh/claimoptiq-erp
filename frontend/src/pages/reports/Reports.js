import React, { useState, useEffect } from 'react';
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI, bulkBillAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlineDownload } from 'react-icons/hi';
import { formatCurrency, calculateFilePrice } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';

const Reports = () => {
  const { user, roleSlug } = useAuth();
  const confirm = useConfirm();
  const isHospitalUser = !!user?.hospital;
  const isSuperAdmin = roleSlug === 'super_admin';
  const [hospitals, setHospitals] = useState([]);
  const [filters, setFilters] = useState({ hospital: '', dateFrom: '', dateTo: '', status: '' });
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [billingLoading, setBillingLoading] = useState(false);

  // Bill mode state
  const [billMode, setBillMode] = useState(false);
  const [selectedClaimIds, setSelectedClaimIds] = useState([]);

  useEffect(() => {
    if (!isHospitalUser) {
      getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    }
    getClaimStatusesAPI()
      .then(({ data }) => setClaimStatuses(data.filter(s => s.isActive !== false && (!s.superAdminOnly || isSuperAdmin))))
      .catch(() => {})
      .finally(() => setStatusesLoading(false));
  }, [isHospitalUser]);

  const fetchClaims = async () => {
    const params = { limit: 10000 };
    if (filters.hospital) params.hospital = filters.hospital;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (filters.status) params.status = filters.status;
    const { data } = await getClaimsAPI(params);
    return data.claims;
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      const result = await fetchClaims();
      setClaims(result);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBill = async () => {
    setSelectedClaimIds([]);
    setBillMode(true);
    if (claims.length > 0) return;
    setLoading(true);
    try {
      const result = await fetchClaims();
      setClaims(result);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBillMode = () => {
    setBillMode(false);
    setSelectedClaimIds([]);
  };

  const handleInitialBill = async () => {
    const ids = selectedClaimIds;
    if (!ids.length) return;
    const ok = await confirm(
      `This will mark ${ids.length} claim${ids.length !== 1 ? 's' : ''} as Billed. Continue?`,
      { title: 'Initial Bill', confirmLabel: 'Mark as Billed', variant: 'primary' }
    );
    if (!ok) return;
    setBillingLoading(true);
    try {
      await bulkBillAPI(ids);
      setClaims(prev => prev.map(c => ids.includes(c._id) ? { ...c, isBilled: true } : c));
      setSelectedClaimIds([]);
      setBillMode(false);
      toast.success(`${ids.length} claim${ids.length !== 1 ? 's' : ''} marked as Billed`);
    } catch {
      toast.error('Failed to mark claims as billed');
    } finally {
      setBillingLoading(false);
    }
  };

  const allSelected = claims.length > 0 && claims.every(c => selectedClaimIds.includes(c._id));
  const someSelected = selectedClaimIds.length > 0;

  const toggleSelectAll = () => {
    if (allSelected) setSelectedClaimIds([]);
    else setSelectedClaimIds(claims.map(c => c._id));
  };

  const toggleClaim = (id) => {
    setSelectedClaimIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // --- Bill Export helpers ---

  const BILL_COLS = ['SR', 'PATIENT NAME', 'DOCTOR NAME', 'CLAIM TYPE', 'COMPANY/TPA', 'CCN NO',
    'D.O.A.', 'D.O.D.', 'HOSPITAL BILL', 'FINAL APPROVAL AMOUNT', 'FILE PRICE'];
  const NUM_BILL_COLS = BILL_COLS.length; // 11

  const groupByHospital = () => {
    const byHosp = {};
    claims.forEach(c => {
      const hosp = c.hospital?.name || 'Unknown';
      if (!byHosp[hosp]) byHosp[hosp] = {};
      const mk = c.month ? new Date(c.month).toISOString().slice(0, 7) : '0000-00';
      if (!byHosp[hosp][mk]) byHosp[hosp][mk] = { month: c.month, items: [] };
      byHosp[hosp][mk].items.push(c);
    });
    return Object.entries(byHosp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hospital, months]) => ({
        hospital,
        monthGroups: Object.values(months).sort((a, b) => (a.month || '').localeCompare(b.month || '')),
      }));
  };

  const billClaimRow = (c) => {
    const companytpa = [c.insuranceCompany?.name, c.tpa?.name].filter(Boolean).join(' / ');
    return [
      c.srNo || '', c.patientName || '', c.doctorName || '', c.claimType || '', companytpa,
      c.ccnNo || '',
      c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
      c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
      c.hospitalFinalBill || 0, c.finalApprovalAmount || 0, getFilePrice(c),
    ];
  };

  const monthLabel = (month) => {
    if (!month) return 'CLAIM';
    const d = new Date(month);
    return `CLAIM - ${d.toLocaleString('en', { month: 'short' }).toUpperCase()} - ${d.getFullYear()}`;
  };

  const fmtAmt = (v) => (typeof v === 'number' && v > 0) ? formatCurrency(v) : (v || '-');

  const buildExcelWB = (hospital, monthGroups) => {
    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    const wsData = [];
    const merges = [];
    const rowMeta = [];

    monthGroups.forEach(({ month, items }) => {
      const rHosp = wsData.length;
      wsData.push([hospital.toUpperCase(), ...Array(NUM_BILL_COLS - 1).fill('')]);
      merges.push({ s: { r: rHosp, c: 0 }, e: { r: rHosp, c: NUM_BILL_COLS - 1 } });
      rowMeta.push({ row: rHosp, type: 'hospital' });

      const rSub = wsData.length;
      wsData.push([monthLabel(month), ...Array(NUM_BILL_COLS - 1).fill('')]);
      merges.push({ s: { r: rSub, c: 0 }, e: { r: rSub, c: NUM_BILL_COLS - 1 } });
      rowMeta.push({ row: rSub, type: 'subtitle' });

      wsData.push([...BILL_COLS]);
      rowMeta.push({ row: wsData.length - 1, type: 'header' });

      items.forEach(c => {
        rowMeta.push({ row: wsData.length, type: 'data' });
        wsData.push(billClaimRow(c));
      });

      const totalFP = items.reduce((s, c) => s + getFilePrice(c), 0);
      const totalRow = Array(NUM_BILL_COLS).fill('');
      totalRow[1] = 'TOTAL';
      totalRow[NUM_BILL_COLS - 1] = totalFP;
      rowMeta.push({ row: wsData.length, type: 'total' });
      wsData.push(totalRow);
      wsData.push(Array(NUM_BILL_COLS).fill(''));
    });

    const rFooter = wsData.length;
    wsData.push(['Prepared by: First Care Consultancy', ...Array(NUM_BILL_COLS - 1).fill('')]);
    merges.push({ s: { r: rFooter, c: 0 }, e: { r: rFooter, c: NUM_BILL_COLS - 1 } });
    rowMeta.push({ row: rFooter, type: 'footer' });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = merges;
    ws['!cols'] = [
      { wch: 5 }, { wch: 22 }, { wch: 20 }, { wch: 14 }, { wch: 30 },
      { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 20 }, { wch: 12 },
    ];

    const applyStyle = (r, c, style) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { v: '', t: 's' };
      ws[ref].s = style;
    };

    rowMeta.forEach(({ row, type }) => {
      const styles = {
        hospital: { font: { bold: true, sz: 12, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'left', vertical: 'center' } },
        subtitle: { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'center', vertical: 'center' }, border },
        header:   { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border },
        footer:   { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'left', vertical: 'center' } },
      };
      for (let c = 0; c < NUM_BILL_COLS; c++) {
        if (type === 'data') {
          applyStyle(row, c, { font: { sz: 9, name: 'Arial' }, alignment: { horizontal: c >= 8 ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'total') {
          applyStyle(row, c, { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'FEF9C3' } }, alignment: { horizontal: c === 1 ? 'center' : c >= 8 ? 'right' : 'left', vertical: 'center' }, border });
        } else if (styles[type]) {
          applyStyle(row, c, styles[type]);
        }
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bill Report');
    return wb;
  };

  const buildPDFDoc = (hospital, monthGroups) => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const today = new Date().toLocaleDateString('en-IN');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Bill Report — ClaimOptiq', 14, 15);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${today}`, 14, 21);

    let startY = 28;

    monthGroups.forEach(({ month, items }) => {
      autoTable(doc, {
        startY,
        body: [[hospital.toUpperCase()]],
        theme: 'plain',
        styles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, cellPadding: 3 },
        margin: { left: 14, right: 14 },
      });
      startY = doc.lastAutoTable.finalY;

      autoTable(doc, {
        startY,
        body: [[monthLabel(month)]],
        theme: 'plain',
        styles: { fontStyle: 'bold', fontSize: 9, halign: 'center', cellPadding: 1.5 },
        tableLineColor: [0, 0, 0], tableLineWidth: 0.3,
        margin: { left: 14, right: 14 },
      });
      startY = doc.lastAutoTable.finalY;

      const totalFP = items.reduce((s, c) => s + getFilePrice(c), 0);
      const totalRow = Array(NUM_BILL_COLS).fill('');
      totalRow[1] = 'TOTAL';
      totalRow[NUM_BILL_COLS - 1] = fmtAmt(totalFP);

      autoTable(doc, {
        startY,
        head: [BILL_COLS],
        body: [
          ...items.map(c => billClaimRow(c).map((v, i) => i >= 8 ? fmtAmt(v) : (v ?? ''))),
          totalRow,
        ],
        theme: 'grid',
        headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: [31, 41, 55], lineColor: [0, 0, 0], lineWidth: 0.3 },
        didParseCell: (data) => {
          if (data.section === 'body' && data.row.index === items.length) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [254, 249, 195];
          }
          if (data.column.index >= 8) data.cell.styles.halign = 'right';
        },
        margin: { left: 14, right: 14 },
      });
      startY = doc.lastAutoTable.finalY + 6;

      if (startY > 170) { doc.addPage(); startY = 14; }
    });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Prepared by: First Care Consultancy', 14, startY + 4);

    return doc;
  };

  const doExportBillExcel = async () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const groups = groupByHospital();

    if (groups.length === 1) {
      const { hospital, monthGroups } = groups[0];
      const wb = buildExcelWB(hospital, monthGroups);
      const safeName = hospital.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
      XLSX.writeFile(wb, `bill_${safeName}_${dateStr}.xlsx`);
      return;
    }

    const zip = new JSZip();
    groups.forEach(({ hospital, monthGroups }) => {
      const wb = buildExcelWB(hospital, monthGroups);
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const safeName = hospital.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
      zip.file(`bill_${safeName}_${dateStr}.xlsx`, buf);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill_report_${dateStr}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doExportBillPDF = async () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const groups = groupByHospital();

    if (groups.length === 1) {
      const { hospital, monthGroups } = groups[0];
      const doc = buildPDFDoc(hospital, monthGroups);
      const safeName = hospital.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
      doc.save(`bill_${safeName}_${dateStr}.pdf`);
      return;
    }

    const zip = new JSZip();
    groups.forEach(({ hospital, monthGroups }) => {
      const doc = buildPDFDoc(hospital, monthGroups);
      const safeName = hospital.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);
      zip.file(`bill_${safeName}_${dateStr}.pdf`, doc.output('arraybuffer'));
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill_report_${dateStr}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getFilePrice = (c) => c.filePrice ||
    calculateFilePrice(c.hospital?.billingServices || [], c.hospitalFinalBill || 0, c.finalApprovalAmount || 0);

  const formatAmount = (a) => a ? formatCurrency(a) : '-';

  const totalBill = claims.reduce((s, c) => s + (c.hospitalFinalBill || 0), 0);
  const totalSettlement = claims.reduce((s, c) => s + (c.bankTransferAmount || 0), 0);
  const totalFilePrice = claims.reduce((s, c) => s + getFilePrice(c), 0);

  const tableColCount = (isHospitalUser ? 9 : 10) + (isSuperAdmin ? 2 : 0) + (billMode ? 1 : 0);

  return (
    <div>
      {/* Title row */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Reports</h1>
          <p className="text-sm text-gray-500">Generate and export claim reports</p>
        </div>
        {isSuperAdmin && (
          billMode ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{selectedClaimIds.length} selected</span>
              <button
                onClick={handleCancelBillMode}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleInitialBill}
                disabled={!someSelected || billingLoading}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {billingLoading ? 'Processing...' : 'Initial Bill'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerateBill}
              disabled={loading}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Generate Bill'}
            </button>
          )
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 mt-6">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          {!isHospitalUser && (
            <SearchableSelect
              options={hospitals.map(h => ({ value: h._id, label: h.name }))}
              value={filters.hospital}
              onChange={val => setFilters({ ...filters, hospital: val })}
              placeholder="All Hospitals"
              searchPlaceholder="Search hospitals..."
              allowClear
            />
          )}
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            placeholder="From Date"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            placeholder="To Date"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <SearchableSelect
            options={claimStatuses.map(s => ({ value: s.slug, label: s.label, badgeClass: STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700' }))}
            value={filters.status}
            onChange={val => setFilters({ ...filters, status: val })}
            placeholder="All Status"
            searchPlaceholder="Search status..."
            isLoading={statusesLoading}
            allowClear
          />
          <div className="flex gap-2">
            <button onClick={generateReport} disabled={loading}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Loading...' : 'Generate'}
            </button>
            <button onClick={doExportBillExcel} disabled={!claims.length}
              className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap">
              <HiOutlineDownload className="w-3.5 h-3.5" /> XLS
            </button>
            <button onClick={doExportBillPDF} disabled={!claims.length}
              className="flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 whitespace-nowrap">
              <HiOutlineDownload className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        </div>
      </div>

      {/* Summary */}
      {claims.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 mb-6 ${isSuperAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{claims.length}</p>
            <p className="text-xs text-gray-500">Total Claims</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{formatAmount(totalBill)}</p>
            <p className="text-xs text-gray-500">Total Hospital Bills</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{formatAmount(totalSettlement)}</p>
            <p className="text-xs text-gray-500">Total Bank Transfers</p>
          </div>
          {isSuperAdmin && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{formatAmount(totalFilePrice)}</p>
              <p className="text-xs text-gray-500">Total Revenue (File Price)</p>
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {billMode && (
                  <th className="py-3 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                    />
                  </th>
                )}
                {['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', ...(isSuperAdmin ? ['Bill Status', 'File Price'] : [])].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={tableColCount} className="py-8 text-center text-gray-400">
                    {loading ? 'Loading...' : 'Click "Generate" to view report'}
                  </td>
                </tr>
              ) : claims.map(c => (
                <tr
                  key={c._id}
                  className={`hover:bg-gray-50 text-sm ${billMode && selectedClaimIds.includes(c._id) ? 'bg-purple-50' : ''}`}
                >
                  {billMode && (
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selectedClaimIds.includes(c._id)}
                        onChange={() => toggleClaim(c._id)}
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                    </td>
                  )}
                  <td className="py-2 px-3 text-gray-500">{c.srNo}</td>
                  <td className="py-2 px-3 font-medium text-gray-800 whitespace-nowrap">{c.patientName}</td>
                  {!isHospitalUser && <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{c.hospital?.name || '-'}</td>}
                  <td className="py-2 px-3 capitalize">{c.claimType}</td>
                  <td className="py-2 px-3">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-2 px-3">{formatAmount(c.finalApprovalAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.settlementAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.tds)}</td>
                  <td className="py-2 px-3">{formatAmount(c.bankTransferAmount)}</td>
                  <td className="py-2 px-3 capitalize">{c.status.replace('_', ' ')}</td>
                  {isSuperAdmin && (
                    <>
                      <td className="py-2 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.isBilled ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600'}`}>
                          {c.isBilled ? 'Billed' : 'Unbilled'}
                        </span>
                      </td>
                      <td className="py-2 px-3">{formatAmount(getFilePrice(c))}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;
