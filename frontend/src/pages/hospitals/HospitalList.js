import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getHospitalsAPI, deleteHospitalAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch, HiOutlineOfficeBuilding } from 'react-icons/hi';

const HospitalList = () => {
  const navigate = useNavigate();
  const { can } = useAuth();
  const confirm = useConfirm();
  const [hospitals, setHospitals] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchHospitals = useCallback(async () => {
    try {
      const { data } = await getHospitalsAPI({ search, active: 'true' });
      setHospitals(data);
    } catch (error) {
      toast.error('Failed to fetch hospitals');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchHospitals(); }, [fetchHospitals]);

  const handleDelete = async (id, name) => {
    if (!await confirm(`Deactivate hospital "${name}"?`, { title: 'Deactivate Hospital', confirmLabel: 'Deactivate', variant: 'danger' })) return;
    try {
      await deleteHospitalAPI(id);
      toast.success('Hospital deactivated');
      fetchHospitals();
    } catch (error) {
      toast.error('Failed to deactivate hospital');
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Hospitals</h1>
          <p className="text-sm text-gray-500 mt-1">{hospitals.length} hospitals registered</p>
        </div>
        {can('hospitals', 'create') && (
          <button
            onClick={() => navigate('/hospitals/new')}
            className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg text-sm font-medium transition-colors"
          >
            <HiOutlinePlus className="w-5 h-5" /> Add Hospital
          </button>
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
            onChange={(e) => setSearch(e.target.value)}
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
                <div key={h._id} className="p-4 active:bg-gray-50"
                  onClick={() => navigate(`/hospitals/${h._id}`)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                        <HiOutlineOfficeBuilding className="w-5 h-5 text-primary-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{h.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[h.city, h.state].filter(Boolean).join(', ') || 'Location not set'}
                        </p>
                      </div>
                    </div>
                    {can('hospitals', 'create') && (
                      <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/hospitals/${h._id}/edit`)}
                          className="p-2.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                        >
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(h._id, h.name)}
                          className="p-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <HiOutlineTrash className="w-4 h-4" />
                        </button>
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
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : hospitals.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">No hospitals found</td></tr>
              ) : (
                hospitals.map((h, idx) => (
                  <tr key={h._id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/hospitals/${h._id}`)}>
                    <td className="py-3 px-4 text-sm text-gray-500">{idx + 1}</td>
                    <td className="py-3 px-4 text-sm font-medium text-gray-800">{h.name}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.phone || h.contact || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.city || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.referenceBy || '-'}</td>
                    <td className="py-3 px-4 text-sm text-gray-600">{h.billingServices?.length || 0}</td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        {can('hospitals', 'create') && (
                          <>
                            <button
                              onClick={() => navigate(`/hospitals/${h._id}/edit`)}
                              className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            >
                              <HiOutlinePencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(h._id, h.name)}
                              className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            >
                              <HiOutlineTrash className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default HospitalList;
