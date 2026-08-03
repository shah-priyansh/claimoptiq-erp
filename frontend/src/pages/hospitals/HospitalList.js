import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getHospitalsAPI, setHospitalStatusAPI, deleteHospitalAPI, deleteAllHospitalsAPI, importHospitalsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch, HiOutlineOfficeBuilding, HiOutlineUpload } from 'react-icons/hi';
import MasterImportModal from '../../components/master/MasterImportModal';
import PaginationBar from '../../components/ui/PaginationBar';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const HOSPITAL_IMPORT_CONFIG = {
  title: 'Import Hospitals',
  entityLabel: 'hospital',
  templateName: 'hospital-import-template.xlsx',
  columns: [
    { key: 'name',        label: 'Name *',       width: 30, required: true, note: 'Hospital name (required)' },
    { key: 'referenceBy', label: 'Reference By', width: 18 },
    { key: 'contact',     label: 'Contact Person', width: 22 },
    { key: 'phone',       label: 'Phone',        width: 14, note: '10-digit Indian mobile (starts 6-9)' },
    { key: 'email',       label: 'Email',        width: 26 },
    { key: 'address',     label: 'Address',      width: 30 },
    { key: 'city',        label: 'City',         width: 14 },
    { key: 'state',       label: 'State',        width: 14 },
    { key: 'pincode',     label: 'Pincode',      width: 12, note: '6-digit Indian pincode' },
  ],
  sampleRow1: { name: 'City Hospital', referenceBy: 'Dr. Mehta', contact: 'Mr. Rao', phone: '9876543210', email: 'admin@cityhospital.in', address: 'Ring Road', city: 'Surat', state: 'Gujarat', pincode: '395003' },
  sampleRow2: { name: 'Aastha Hospital', referenceBy: '', contact: '', phone: '', email: '', address: '', city: '', state: '', pincode: '' },
  uploadAPI:  importHospitalsAPI,
};

const HospitalList = () => {
  const navigate = useNavigate();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [hospitals, setHospitals] = useState([]);
  // Search resets on remount by design — the operator hits "Hospitals" expecting
  // a fresh list, not the query they typed 20 minutes ago. Page/pageSize below
  // stay persisted so returning from a detail page keeps their position.
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = usePersistedFilters('hospitals:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('hospitals:pageSize', 100);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const fetchHospitals = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getHospitalsAPI({ search, page, limit: pageSize });
      setHospitals(data.hospitals);
      setTotal(data.total);
      setPages(data.pages);
    } catch (error) {
      toast.error('Failed to fetch hospitals');
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize]);

  useEffect(() => { fetchHospitals(); }, [fetchHospitals]);

  const handleSearchChange = (val) => {
    setSearch(val);
    setPage(1);
  };

  const handleDelete = async (id, name) => {
    if (!await confirm(
      `Delete hospital "${name}"? If it isn't linked to any claim, user or invoice it will be permanently deleted — otherwise it will be deactivated instead.`,
      { title: 'Delete Hospital', confirmLabel: 'Delete', variant: 'danger' }
    )) return;
    try {
      const { data } = await deleteHospitalAPI(id);
      toast.success(data?.message || (data?.deleted ? 'Hospital deleted' : 'Hospital deactivated'));
      fetchHospitals();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete hospital');
    }
  };

  // Inline Active/Inactive toggle straight from the list — no need to open the
  // edit form. Updates the row in place on success (no full refetch flash).
  const toggleActive = async (h) => {
    if (!can('hospitals', 'edit') || togglingId) return;
    const next = h.isActive === false; // currently inactive → activate, else deactivate
    setTogglingId(h._id);
    try {
      await setHospitalStatusAPI(h._id, next);
      setHospitals((list) => list.map((x) => (x._id === h._id ? { ...x, isActive: next } : x)));
      toast.success(next ? 'Hospital activated' : 'Hospital deactivated');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update status');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllConfirm.trim() !== 'DELETE ALL') {
      toast.error('Type DELETE ALL to confirm');
      return;
    }
    setDeletingAll(true);
    try {
      const { data } = await deleteAllHospitalsAPI();
      toast.success(data?.message || 'All hospitals deactivated');
      setDeleteAllOpen(false);
      setDeleteAllConfirm('');
      fetchHospitals();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to deactivate hospitals');
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-4 mb-6">
        {can('hospitals', 'delete') && total > 0 && (
          <button
            onClick={() => { setDeleteAllConfirm(''); setDeleteAllOpen(true); }}
            className="flex items-center justify-center gap-2 bg-white border border-red-600 text-red-700 hover:bg-red-50 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
          >
            <HiOutlineTrash className="w-5 h-5" /> Delete All
          </button>
        )}
        {can('hospitals', 'create') && (
          <>
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center justify-center gap-2 bg-white border border-primary-600 text-primary-700 hover:bg-primary-50 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              <HiOutlineUpload className="w-5 h-5" /> Import
            </button>
            <button
              onClick={() => navigate('/hospitals/new')}
              className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              <HiOutlinePlus className="w-5 h-5" /> Add Hospital
            </button>
          </>
        )}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 p-4">
        <div className="relative">
          <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search hospitals..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Mobile Cards */}
        <div className="md:hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Loading...</div>
          ) : hospitals.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No hospitals found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {hospitals.map((h) => (
                <div
                  key={h._id}
                  className={`p-4 ${can('hospitals', 'edit') ? 'active:bg-gray-50 cursor-pointer' : ''}`}
                  onClick={can('hospitals', 'edit') ? () => navigate(`/hospitals/${h._id}/edit`) : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                        <HiOutlineOfficeBuilding className="w-5 h-5 text-primary-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-gray-800 truncate">{h.name}</p>
                          {h.parent && <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-medium flex-shrink-0">Branch of {h.parent.name}</span>}
                          {!h.parent && h._count?.branches > 0 && <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium flex-shrink-0">{h._count.branches} {h._count.branches === 1 ? 'branch' : 'branches'}</span>}
                          {can('hospitals', 'edit') ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); toggleActive(h); }}
                              disabled={togglingId === h._id}
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 transition-colors disabled:opacity-50 ${
                                h.isActive === false
                                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200'
                              }`}
                            >
                              {h.isActive === false ? 'Inactive' : 'Active'}
                            </button>
                          ) : h.isActive === false ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600 flex-shrink-0">Inactive</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 flex-shrink-0">Active</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[h.city, h.state].filter(Boolean).join(', ') || 'Location not set'}
                        </p>
                      </div>
                    </div>
                    {(can('hospitals', 'edit') || can('hospitals', 'delete')) && (
                      <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {can('hospitals', 'edit') && (
                          <button
                            onClick={() => navigate(`/hospitals/${h._id}/edit`)}
                            className="p-2.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          >
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {can('hospitals', 'delete') && (
                          <button
                            onClick={() => handleDelete(h._id, h.name)}
                            className="p-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-gray-500 ml-13">
                    {(h.phone || h.contact) && (
                      <span>{h.phone || h.contact}</span>
                    )}
                    {h.referenceBy && (
                      <span>Ref: {h.referenceBy}</span>
                    )}
                    {(h.billingServices?.length > 0) && (
                      <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">
                        {h.billingServices.length} service{h.billingServices.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {(h.doctors?.length > 0) && (
                      <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded font-medium">
                        {h.doctors.length} doctor{h.doctors.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hospital Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Contact</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">City</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reference By</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Services</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : hospitals.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">No hospitals found</td></tr>
              ) : (
                hospitals.map((h, idx) => (
                  <tr
                    key={h._id}
                    className={`hover:bg-gray-50 ${can('hospitals', 'edit') ? 'cursor-pointer' : ''}`}
                    onClick={can('hospitals', 'edit') ? () => navigate(`/hospitals/${h._id}/edit`) : undefined}
                  >
                    <td className="py-3 px-4 text-sm text-gray-500">{(page - 1) * pageSize + idx + 1}</td>
                    <td className="py-3 px-4 text-sm font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <span>{h.name}</span>
                        {h.parent && <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-medium">Branch of {h.parent.name}</span>}
                        {!h.parent && h._count?.branches > 0 && <span className="px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-medium">{h._count.branches} {h._count.branches === 1 ? 'branch' : 'branches'}</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.phone || h.contact || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.city || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.referenceBy || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.billingServices?.length || 0}</td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      {can('hospitals', 'edit') ? (
                        <button
                          type="button"
                          onClick={() => toggleActive(h)}
                          disabled={togglingId === h._id}
                          title={h.isActive === false ? 'Click to activate' : 'Click to deactivate'}
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors disabled:opacity-50 ${
                            h.isActive === false
                              ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {h.isActive === false ? 'Inactive' : 'Active'}
                        </button>
                      ) : h.isActive === false ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {can('hospitals', 'edit') && (
                          <button
                            onClick={() => navigate(`/hospitals/${h._id}/edit`)}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                          >
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {can('hospitals', 'delete') && (
                          <button
                            onClick={() => handleDelete(h._id, h.name)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <PaginationBar
          page={page}
          pages={pages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={n => { setPageSize(n); setPage(1); }}
          label="hospitals"
        />
      </div>

      <MasterImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={fetchHospitals}
        config={HOSPITAL_IMPORT_CONFIG}
      />

      {deleteAllOpen && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-red-600 to-red-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <HiOutlineTrash className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Deactivate all hospitals?</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Every active hospital is marked inactive. Linked claims, invoices, and users are kept intact.
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Type <span className="font-mono font-bold text-red-600">DELETE ALL</span> to confirm:
              </p>
              <input
                autoFocus
                value={deleteAllConfirm}
                onChange={e => setDeleteAllConfirm(e.target.value)}
                placeholder="DELETE ALL"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-red-400"
              />
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setDeleteAllOpen(false); setDeleteAllConfirm(''); }}
                  disabled={deletingAll}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleDeleteAll}
                  disabled={deletingAll || deleteAllConfirm.trim() !== 'DELETE ALL'}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                  {deletingAll ? 'Deactivating…' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default HospitalList;
