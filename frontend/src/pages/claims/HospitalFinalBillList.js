import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlineSearch, HiOutlinePencil, HiOutlineDownload, HiOutlineDocumentText } from 'react-icons/hi';
import { getHospitalFinalBillsAPI, getHospitalsAPI, getHospitalFinalBillPdfURL } from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import PaginationBar from '../../components/ui/PaginationBar';
import Loader from '../../components/ui/Loader';
import usePersistedFilters from '../../hooks/usePersistedFilters';
import { formatCurrency, formatDate } from '../../utils/format';
import HospitalFinalBillModal from './HospitalFinalBillModal';

const HospitalFinalBillList = () => {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [hospitals, setHospitals] = useState([]);
  const [page, setPage] = usePersistedFilters('hospitalFinalBills:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('hospitalFinalBills:pageSize', 25);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [editingClaim, setEditingClaim] = useState(null);

  useEffect(() => {
    getHospitalsAPI({ all: 'true', active: 'true' })
      .then(({ data }) => setHospitals(Array.isArray(data) ? data : (data?.hospitals || [])))
      .catch(() => {});
  }, []);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getHospitalFinalBillsAPI({ search, hospital: hospitalId, page, limit: pageSize });
      setBills(data.bills || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      toast.error('Failed to load Hospital Final Bills');
    } finally {
      setLoading(false);
    }
  }, [search, hospitalId, page, pageSize]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const handleSearchChange = (val) => { setSearch(val); setPage(1); };
  const handleHospitalChange = (val) => { setHospitalId(val); setPage(1); };

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 mb-4 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by patient name or bill no..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="sm:w-72">
          <SearchableSelect
            value={hospitalId}
            onChange={handleHospitalChange}
            options={hospitals.map((h) => ({ value: h._id, label: h.name }))}
            placeholder="All hospitals"
            searchPlaceholder="Search hospitals..."
            allowClear
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Mobile cards */}
        <div className="md:hidden">
          {loading ? (
            <Loader label="Loading…" className="py-12" />
          ) : bills.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No Hospital Final Bills found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {bills.map((b) => (
                <div key={b._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{b.claim?.patientName || '—'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{b.hospital?.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Bill No. {b.billNoFormatted} · {formatDate(b.billDate)}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold text-primary-700">{formatCurrency(b.finalAmount)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => setEditingClaim(b.claim)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50">
                      <HiOutlinePencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <a href={getHospitalFinalBillPdfURL(b.claim?._id)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                      <HiOutlineDownload className="w-3.5 h-3.5" /> PDF
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Bill No.</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hospital</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Patient</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Bill Date</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Final Amount</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="py-8"><Loader label="Loading…" /></td></tr>
              ) : bills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    <HiOutlineDocumentText className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                    No Hospital Final Bills found
                  </td>
                </tr>
              ) : (
                bills.map((b) => (
                  <tr key={b._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 text-sm font-medium text-gray-800">{b.billNoFormatted}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{b.hospital?.name || '—'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{b.claim?.patientName || '—'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{formatDate(b.billDate)}</td>
                    <td className="py-3 px-4 text-sm text-right font-semibold text-gray-800">{formatCurrency(b.finalAmount)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <a href={getHospitalFinalBillPdfURL(b.claim?._id)} target="_blank" rel="noreferrer"
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Download PDF">
                          <HiOutlineDownload className="w-4 h-4" />
                        </a>
                        <button onClick={() => setEditingClaim(b.claim)}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg" title="Edit">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          label="bills"
        />
      </div>

      <HospitalFinalBillModal
        open={!!editingClaim}
        claim={editingClaim}
        onClose={() => setEditingClaim(null)}
        onSaved={async () => {
          setEditingClaim(null);
          await fetchBills();
        }}
      />
    </div>
  );
};

export default HospitalFinalBillList;
