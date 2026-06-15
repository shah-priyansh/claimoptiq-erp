import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineEye, HiOutlineSearch } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import { getInvoicesAPI, deleteInvoiceAPI, getHospitalsAPI } from '../../services/api';

const STATUS_COLORS = {
  draft:          'bg-gray-100 text-gray-700',
  issued:         'bg-blue-50 text-blue-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid:           'bg-green-50 text-green-700',
  void:           'bg-red-50 text-red-700',
};

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatMonth = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

const InvoiceList = () => {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('invoices', 'create');
  const canDelete = can('invoices', 'delete');

  const [items, setItems] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ hospitalId: '', status: '', month: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (filters.hospitalId) params.hospitalId = filters.hospitalId;
      if (filters.status) params.status = filters.status;
      if (filters.month) params.month = filters.month + '-01';
      const { data } = await getInvoicesAPI(params);
      setItems(data.invoices || []);
      setTotal(data.total || 0);
    } catch {
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getHospitalsAPI().then(({ data }) => {
      const list = Array.isArray(data) ? data : data.hospitals;
      setHospitals((list || []).filter((h) => h.isActive !== false));
    }).catch(() => {});
  }, []);

  useEffect(() => { fetchInvoices(); /* eslint-disable-next-line */ }, [page, pageSize, filters.hospitalId, filters.status, filters.month]);

  const handleDelete = async (item) => {
    if (item.status !== 'draft') {
      toast.error('Only draft invoices can be deleted');
      return;
    }
    if (!(await confirm(`Delete draft for ${item.hospital?.name} ${formatMonth(item.month)}?`, { title: 'Delete Draft', confirmLabel: 'Delete' }))) return;
    try {
      await deleteInvoiceAPI(item._id);
      toast.success('Draft deleted');
      fetchInvoices();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Invoices</h1>
          <p className="text-sm text-gray-500">Monthly hospital billing — TPA Desk, fixed services, GST/TDS</p>
        </div>
        {canCreate && (
          <button onClick={() => navigate('/invoices/new')}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg">
            <HiOutlinePlus className="w-4 h-4" /> New Invoice
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hospital</label>
            <select value={filters.hospitalId}
              onChange={(e) => { setFilters((f) => ({ ...f, hospitalId: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">All hospitals</option>
              {hospitals.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select value={filters.status}
              onChange={(e) => { setFilters((f) => ({ ...f, status: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
            <input type="month" value={filters.month}
              onChange={(e) => { setFilters((f) => ({ ...f, month: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="flex items-end">
            <button onClick={() => { setFilters({ hospitalId: '', status: '', month: '' }); setPage(1); }}
              className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No invoices found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left py-3 px-4">Invoice #</th>
                  <th className="text-left py-3 px-4">Hospital</th>
                  <th className="text-left py-3 px-4">Month</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Grand Total</th>
                  <th className="text-right py-3 px-4">Paid</th>
                  <th className="text-right py-3 px-4">Pending</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((inv) => (
                  <tr key={inv._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">
                      <Link to={`/invoices/${inv._id}`} className="text-primary-600 hover:underline">
                        {inv.invoiceNumber || `Draft-${(inv._id || '').slice(0, 8)}`}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{inv.hospital?.name || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">{formatMonth(inv.month)}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-800 font-medium">{formatINR(inv.grandTotal)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{formatINR(inv.amountPaid)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{formatINR(inv.amountPending)}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => navigate(`/invoices/${inv._id}`)}
                          className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                          <HiOutlineEye className="w-4 h-4" />
                        </button>
                        {canDelete && inv.status === 'draft' && (
                          <button onClick={() => handleDelete(inv)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 && (
          <PaginationBar
            page={page} pages={pages} total={total}
            pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </div>
  );
};

export default InvoiceList;
