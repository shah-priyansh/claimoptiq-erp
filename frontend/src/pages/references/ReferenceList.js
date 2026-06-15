import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getReferencesAPI,
  createReferenceAPI,
  updateReferenceAPI,
  deleteReferenceAPI,
  getBillingServiceNamesAPI,
} from '../../services/api';
import ReferenceFormModal from './ReferenceFormModal';

const ReferenceList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('references', 'create');
  const canEdit = can('references', 'edit');
  const canDelete = can('references', 'delete');

  const [items, setItems] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) => (r.name || '').toLowerCase().includes(q) || (r.mobile || '').includes(q),
    );
  }, [items, search]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const fetchAll = async () => {
    try {
      const [refs, svcs] = await Promise.all([getReferencesAPI(), getBillingServiceNamesAPI()]);
      setItems(refs.data);
      setServices(svcs.data);
    } catch {
      toast.error('Failed to load references');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateReferenceAPI(modal.item._id, form);
        toast.success('Reference updated');
      } else {
        await createReferenceAPI(form);
        toast.success('Reference added');
      }
      setModal({ open: false, item: null });
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
      throw error;
    }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete "${item.name}"?`, { title: 'Delete Reference', confirmLabel: 'Delete' }))) return;
    try {
      const { data } = await deleteReferenceAPI(item._id);
      toast.success(data.message || 'Deleted');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">References</h1>
          <p className="text-sm text-gray-500">Commission engine — commission % and applicable services per reference</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Reference
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-sm">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or mobile"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No references found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left py-3 px-4">Name</th>
                  <th className="text-left py-3 px-4">Mobile</th>
                  <th className="text-left py-3 px-4">Commission %</th>
                  <th className="text-left py-3 px-4">Applicable Services</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((r) => (
                  <tr key={r._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">{r.name}</td>
                    <td className="py-3 px-4 text-gray-600">{r.mobile || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">{r.commissionRate}%</td>
                    <td className="py-3 px-4 text-gray-600">
                      <div className="flex flex-wrap gap-1">
                        {(r.applicableServices || []).map((s) => (
                          <span key={s._id} className="px-2 py-0.5 text-xs bg-primary-50 text-primary-700 rounded">
                            {s.billingServiceName?.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <button
                            onClick={() => setModal({ open: true, item: r })}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"
                          >
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(r)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                          >
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
            page={currentPage}
            pages={pages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>

      <ReferenceFormModal
        open={modal.open}
        initial={modal.item}
        services={services}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default ReferenceList;
