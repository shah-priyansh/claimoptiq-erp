import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlineTrash, HiOutlineEye, HiOutlineDownload,
  HiOutlineDotsVertical, HiOutlineCheckCircle, HiOutlinePrinter,
  HiOutlineChartBar,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getInvoicesAPI, deleteInvoiceAPI, getHospitalsAPI, openInvoicePdf,
  createCashBankAPI, getBankAccountsAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import CashBankFormModal from '../cashbank/CashBankFormModal';

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
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  // Bank accounts feed the Mark-as-Paid modal's bank picker.
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ hospitalId: '', status: '', month: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const [actionMenu, setActionMenu] = useState(null); // { id, top?, bottom?, left }
  const [markingPaidId, setMarkingPaidId] = useState(null);
  // When set, the Cash/Bank entry modal opens pre-filled to record a receipt
  // against this invoice. The user can adjust mode/amount/UTR before saving.
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const actionMenuRef = useRef(null);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const openActionMenu = (e, id) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const menuWidth = 200;
    const estH = 180;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < estH && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8));
    setActionMenu(openUp
      ? { id, bottom: window.innerHeight - r.top + 4, left }
      : { id, top: r.bottom + 4, left });
  };

  useEffect(() => {
    if (!actionMenu) return;
    const close = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) setActionMenu(null);
    };
    const onScroll = () => setActionMenu(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [actionMenu]);

  const downloadPdf = async (inv) => {
    setPdfLoadingId(inv._id);
    try {
      await openInvoicePdf(inv._id, inv.invoiceNumber || `draft-${(inv._id || '').slice(0, 8)}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load PDF');
    } finally {
      setPdfLoadingId(null);
    }
  };

  // Open the Cash/Bank entry modal pre-linked to the invoice. The user can
  // tweak the mode / amount / reference number before saving — replaces the
  // old "instantly record full cash payment" behaviour.
  const markPaid = (inv) => {
    const pending = Math.max(0, Math.round(inv.amountPending || 0));
    if (pending <= 0) {
      toast.info('Invoice is already fully paid');
      return;
    }
    setPaymentInvoice(inv);
  };

  const handlePaymentSave = async (form) => {
    if (!paymentInvoice) return;
    setMarkingPaidId(paymentInvoice._id);
    try {
      await createCashBankAPI({
        ...form,
        direction: 'in', // mark-as-paid is always a receipt
        invoiceId: paymentInvoice._id,
      });
      toast.success('Payment recorded');
      setPaymentInvoice(null);
      fetchInvoices();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setMarkingPaidId(null);
    }
  };

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
    getHospitalsAPI({ all: 'true' }).then(({ data }) => {
      const list = Array.isArray(data) ? data : data.hospitals;
      setHospitals((list || []).filter((h) => h.isActive !== false));
    }).catch(() => {}).finally(() => setLoadingHospitals(false));
    getBankAccountsAPI({ active: 'true' })
      .then(({ data }) => setBankAccounts(data || []))
      .catch(() => setBankAccounts([]))
      .finally(() => setLoadingBankAccounts(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchInvoices(); }, [page, pageSize, filters.hospitalId, filters.status, filters.month]);

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
    <div>
      <div className="flex justify-end mb-4 gap-2">
        <button
          onClick={() => navigate('/reports/claims')}
          className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          title="Open the original claim-level report"
        >
          <HiOutlineChartBar className="w-4 h-4 text-primary-600" /> Claims Report
        </button>
        {canCreate && (
          <button onClick={() => navigate('/invoices/new')}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> New Invoice
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hospital</label>
            <SearchableSelect
              isLoading={loadingHospitals}
              value={filters.hospitalId}
              onChange={(v) => { setFilters((f) => ({ ...f, hospitalId: v })); setPage(1); }}
              placeholder="All hospitals"
              searchPlaceholder="Search hospitals..."
              noneLabel="All hospitals"
              allowClear
              options={hospitals.map((h) => ({ value: h._id, label: h.name }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <SearchableSelect
              value={filters.status}
              onChange={(v) => { setFilters((f) => ({ ...f, status: v })); setPage(1); }}
              placeholder="All statuses"
              searchPlaceholder="Search status..."
              noneLabel="All statuses"
              allowClear
              options={[
                { value: 'draft',          label: 'Draft',          badgeClass: 'bg-gray-100 text-gray-700' },
                { value: 'issued',         label: 'Issued',         badgeClass: 'bg-blue-50 text-blue-700' },
                { value: 'partially_paid', label: 'Partially Paid', badgeClass: 'bg-amber-50 text-amber-700' },
                { value: 'paid',           label: 'Paid',           badgeClass: 'bg-green-50 text-green-700' },
                { value: 'void',           label: 'Void',           badgeClass: 'bg-red-50 text-red-700' },
              ]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
            <input type="month" value={filters.month}
              onChange={(e) => { setFilters((f) => ({ ...f, month: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-700" />
          </div>
          <div className="flex items-end">
            <button onClick={() => { setFilters({ hospitalId: '', status: '', month: '' }); setPage(1); }}
              className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors">
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No invoices found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hospital</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Month</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Grand Total</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Paid</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Pending</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
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
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-700'}`}>
                          {inv.status.replace('_', ' ')}
                        </span>
                        {(inv.status === 'issued' || inv.status === 'partially_paid')
                          && (inv.amountPending || 0) > 0
                          && inv.dueDate && new Date(inv.dueDate) < new Date() && (
                          <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium">overdue</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-800 font-medium">{formatINR(inv.grandTotal)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{formatINR(inv.amountPaid)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{formatINR(inv.amountPending)}</td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => openActionMenu(e, inv._id)}
                        disabled={markingPaidId === inv._id || pdfLoadingId === inv._id}
                        title="More actions"
                        className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:cursor-wait rounded-lg">
                        {(markingPaidId === inv._id || pdfLoadingId === inv._id)
                          ? <span className="inline-block w-4 h-4 rounded-full border-2 border-gray-300 border-t-primary-600 animate-spin" />
                          : <HiOutlineDotsVertical className="w-4 h-4" />}
                      </button>
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

      {actionMenu && ReactDOM.createPortal(
        (() => {
          const inv = items.find((x) => x._id === actionMenu.id);
          if (!inv) return null;
          const canMarkPaid =
            (inv.status === 'issued' || inv.status === 'partially_paid')
            && (inv.amountPending || 0) > 0;
          return (
            <div
              ref={actionMenuRef}
              style={{
                position: 'fixed',
                left: actionMenu.left,
                width: 200,
                ...(actionMenu.top !== undefined ? { top: actionMenu.top } : { bottom: actionMenu.bottom }),
              }}
              className="bg-white border border-gray-200 rounded-lg shadow-lg z-[60] py-1">
              <button
                onClick={() => { setActionMenu(null); navigate(`/invoices/${inv._id}`); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlineEye className="w-4 h-4 text-primary-600" /> View
              </button>
              <button
                onClick={() => { setActionMenu(null); downloadPdf(inv); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlineDownload className="w-4 h-4 text-primary-600" /> Download PDF
              </button>
              <button
                onClick={() => { setActionMenu(null); downloadPdf(inv); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlinePrinter className="w-4 h-4 text-primary-600" /> Print
              </button>
              {canMarkPaid && (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => { setActionMenu(null); markPaid(inv); }}
                    className="w-full text-left px-3 py-2 text-sm text-green-700 hover:bg-green-50 flex items-center gap-2">
                    <HiOutlineCheckCircle className="w-4 h-4" /> Mark as Paid
                  </button>
                </>
              )}
              {canDelete && inv.status === 'draft' && (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => { setActionMenu(null); handleDelete(inv); }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <HiOutlineTrash className="w-4 h-4" /> Delete Draft
                  </button>
                </>
              )}
            </div>
          );
        })(),
        document.body,
      )}

      {/* Cash/Bank receipt modal, pre-linked to the chosen invoice. */}
      <CashBankFormModal
        open={!!paymentInvoice}
        initial={paymentInvoice ? {
          direction: 'in',
          mode: 'cash',
          amount: Math.max(0, Math.round(paymentInvoice.amountPending || 0)),
          date: new Date().toISOString().slice(0, 10),
          notes: '',
          invoice: { _id: paymentInvoice._id },
        } : null}
        invoices={paymentInvoice ? [paymentInvoice] : []}
        expenses={[]}
        bankAccounts={bankAccounts}
        loadingInvoices={false}
        loadingExpenses={false}
        loadingBankAccounts={loadingBankAccounts}
        onClose={() => setPaymentInvoice(null)}
        onSave={handlePaymentSave}
      />
    </div>
  );
};

export default InvoiceList;
