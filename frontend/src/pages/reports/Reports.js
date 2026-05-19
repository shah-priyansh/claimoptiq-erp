import React, { useState, useEffect, useRef } from 'react';
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlineDownload } from 'react-icons/hi';
import { formatCurrency } from '../../utils/format';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const Reports = () => {
  const { user, roleSlug } = useAuth();
  const isHospitalUser = !!user?.hospital;
  const isSuperAdmin = roleSlug === 'super_admin';
  const [hospitals, setHospitals] = useState([]);
  const [filters, setFilters] = useState({ hospital: '', dateFrom: '', dateTo: '', status: '' });
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [billDropdownOpen, setBillDropdownOpen] = useState(false);
  const billDropdownRef = useRef(null);

  useEffect(() => {
    if (!billDropdownOpen) return;
    const handler = (e) => {
      if (billDropdownRef.current && !billDropdownRef.current.contains(e.target)) {
        setBillDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [billDropdownOpen]);

  useEffect(() => {
    if (!isHospitalUser) {
      getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    }
    getClaimStatusesAPI()
      .then(({ data }) => setClaimStatuses(data.filter(s => s.isActive !== false)))
      .catch(() => {});
  }, [isHospitalUser]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = { limit: 10000 };
      if (filters.hospital) params.hospital = filters.hospital;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.status) params.status = filters.status;
      const { data } = await getClaimsAPI(params);
      setClaims(data.claims);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!claims.length) return;
    const headers = ['SR', 'Month', 'Patient Name', 'Hospital', 'Claim Type', 'Insurance', 'TPA',
      'Policy No', 'DOA', 'DOD', 'Hospital Bill', 'Deduction', 'Final Approval',
      'Settlement Amount', 'TDS', 'Bank Transfer', 'Status',
      ...(isSuperAdmin ? ['File Price'] : [])];
    const rows = claims.map(c => [
      c.srNo, c.month ? new Date(c.month).toLocaleDateString('en-IN') : '',
      c.patientName, c.hospital?.name || '', c.claimType,
      c.insuranceCompany?.name || '', c.tpa?.name || '',
      c.policyNo, c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
      c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
      c.hospitalFinalBill, c.deduction, c.finalApprovalAmount,
      c.settlementAmount, c.tds, c.bankTransferAmount, c.status,
      ...(isSuperAdmin ? [c.filePrice] : [])
    ]);

    const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claim_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const BILL_COLS = ['SR', 'Patient Name', 'Claim Type', 'Insurance', 'TPA', 'Policy No', 'DOA', 'DOD',
    'Hospital Bill', 'Approval Amount', 'Settlement Amount', 'TDS', 'Bank Transfer', 'Status', 'File Price'];

  const buildGroupedData = () => {
    const grouped = {};
    claims.forEach(c => {
      const name = c.hospital?.name || 'Unknown';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push(c);
    });
    return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
  };

  const claimRow = (c) => [
    c.srNo, c.patientName, c.claimType,
    c.insuranceCompany?.name || '', c.tpa?.name || '', c.policyNo,
    c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
    c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
    c.hospitalFinalBill || 0, c.finalApprovalAmount || 0, c.settlementAmount || 0,
    c.tds || 0, c.bankTransferAmount || 0, c.status, c.filePrice || 0,
  ];

  const subtotalRow = (groupClaims) => {
    const sum = (key) => groupClaims.reduce((s, c) => s + (c[key] || 0), 0);
    return ['', 'Subtotal', '', '', '', '', '', '',
      sum('hospitalFinalBill'), sum('finalApprovalAmount'), sum('settlementAmount'),
      sum('tds'), sum('bankTransferAmount'), '', sum('filePrice')];
  };

  const grandTotalRow = () => {
    const sum = (key) => claims.reduce((s, c) => s + (c[key] || 0), 0);
    return ['', 'Grand Total', '', '', '', '', '', '',
      sum('hospitalFinalBill'), sum('finalApprovalAmount'), sum('settlementAmount'),
      sum('tds'), sum('bankTransferAmount'), '', sum('filePrice')];
  };

  const exportBillExcel = () => {
    if (!claims.length) return;
    setBillDropdownOpen(false);
    const groups = buildGroupedData();
    const wb = XLSX.utils.book_new();
    const wsData = [];
    const merges = [];
    const rowStyles = []; // track row index → style type

    const numCols = BILL_COLS.length;

    groups.forEach(([hospitalName, groupClaims]) => {
      // Hospital header row
      const headerRowIdx = wsData.length;
      wsData.push([hospitalName, ...Array(numCols - 1).fill('')]);
      merges.push({ s: { r: headerRowIdx, c: 0 }, e: { r: headerRowIdx, c: numCols - 1 } });
      rowStyles.push({ idx: headerRowIdx, type: 'hospital' });

      // Column headers
      const colHeaderIdx = wsData.length;
      wsData.push(BILL_COLS);
      rowStyles.push({ idx: colHeaderIdx, type: 'colHeader' });

      // Claim rows
      groupClaims.forEach(c => {
        wsData.push(claimRow(c));
      });

      // Subtotal
      const subtotalIdx = wsData.length;
      wsData.push(subtotalRow(groupClaims));
      rowStyles.push({ idx: subtotalIdx, type: 'subtotal' });

      wsData.push([]); // spacer
    });

    // Grand total
    const grandIdx = wsData.length;
    wsData.push(grandTotalRow());
    rowStyles.push({ idx: grandIdx, type: 'grandTotal' });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = merges;

    // Column widths
    ws['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 14 },
      { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
      { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Bill Report');
    XLSX.writeFile(wb, `bill_grouped_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportBillPDF = () => {
    if (!claims.length) return;
    setBillDropdownOpen(false);
    const groups = buildGroupedData();
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const today = new Date().toLocaleDateString('en-IN');

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Bill Report — ClaimOptiq', 14, 15);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${today}`, 14, 21);

    let startY = 28;

    groups.forEach(([hospitalName, groupClaims], gi) => {
      // Hospital header band
      doc.autoTable({
        startY,
        body: [[hospitalName]],
        theme: 'plain',
        styles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 10, cellPadding: 3 },
        columnStyles: { 0: { cellWidth: 'auto' } },
        margin: { left: 14, right: 14 },
        didDrawPage: (data) => { if (gi === 0) startY = data.cursor.y; },
      });
      startY = doc.lastAutoTable.finalY;

      // Claims table
      doc.autoTable({
        startY,
        head: [BILL_COLS],
        body: [
          ...groupClaims.map(c => claimRow(c).map((v, i) => {
            if (i >= 8 && i <= 12 || i === 14) return v > 0 ? formatCurrency(v) : '-';
            return v ?? '';
          })),
          subtotalRow(groupClaims).map((v, i) => {
            if (i >= 8 && i <= 12 || i === 14) return typeof v === 'number' && v > 0 ? formatCurrency(v) : (v || '');
            return v || '';
          }),
        ],
        theme: 'grid',
        headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: [31, 41, 55] },
        didParseCell: (data) => {
          const isSubtotal = data.row.index === groupClaims.length;
          if (isSubtotal) {
            data.cell.styles.fillColor = [254, 249, 195];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: 14, right: 14 },
      });
      startY = doc.lastAutoTable.finalY + 4;
    });

    // Grand total
    doc.autoTable({
      startY,
      body: [grandTotalRow().map((v, i) => {
        if (i >= 8 && i <= 12 || i === 14) return typeof v === 'number' && v > 0 ? formatCurrency(v) : (v || '');
        return v || '';
      })],
      columns: BILL_COLS.map(h => ({ header: h })),
      theme: 'plain',
      bodyStyles: { fillColor: [220, 252, 231], fontStyle: 'bold', fontSize: 7 },
      margin: { left: 14, right: 14 },
    });

    doc.save(`bill_grouped_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const formatAmount = (a) => a ? formatCurrency(a) : '-';

  // Summary stats
  const totalBill = claims.reduce((s, c) => s + (c.hospitalFinalBill || 0), 0);
  const totalSettlement = claims.reduce((s, c) => s + (c.bankTransferAmount || 0), 0);
  const totalFilePrice = claims.reduce((s, c) => s + (c.filePrice || 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Reports</h1>
      <p className="text-sm text-gray-500 mb-6">Generate and export claim reports</p>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          {!isHospitalUser && (
            <select value={filters.hospital} onChange={(e) => setFilters({ ...filters, hospital: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">All Hospitals</option>
              {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
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
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
            <option value="">All Status</option>
            {claimStatuses.map(s => (
              <option key={s.id} value={s.slug}>{s.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={generateReport} disabled={loading}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Loading...' : 'Generate'}
            </button>
            <button onClick={exportCSV} disabled={!claims.length}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              <HiOutlineDownload className="w-4 h-4" /> CSV
            </button>
            {isSuperAdmin && (
              <div className="relative" ref={billDropdownRef}>
                <button
                  onClick={() => setBillDropdownOpen(o => !o)}
                  disabled={!claims.length}
                  className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  <HiOutlineDownload className="w-4 h-4" /> Generate Bill
                </button>
                {billDropdownOpen && (
                  <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                    <button
                      onClick={exportBillExcel}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg flex items-center gap-2"
                    >
                      <span className="text-green-600 font-bold text-xs">XLS</span> Export Excel (.xlsx)
                    </button>
                    <button
                      onClick={exportBillPDF}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-b-lg border-t border-gray-100 flex items-center gap-2"
                    >
                      <span className="text-red-600 font-bold text-xs">PDF</span> Export PDF
                    </button>
                  </div>
                )}
              </div>
            )}
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
                {['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', ...(isSuperAdmin ? ['File Price'] : [])].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.length === 0 ? (
                <tr><td colSpan={isHospitalUser ? (isSuperAdmin ? 10 : 9) : (isSuperAdmin ? 11 : 10)} className="py-8 text-center text-gray-400">
                  {loading ? 'Loading...' : 'Click "Generate" to view report'}
                </td></tr>
              ) : claims.map(c => (
                <tr key={c._id} className="hover:bg-gray-50 text-sm">
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
                  {isSuperAdmin && <td className="py-2 px-3">{formatAmount(c.filePrice)}</td>}
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
