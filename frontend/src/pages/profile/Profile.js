import React, { useState } from 'react';
import { toast } from 'react-toastify';
import {
  HiOutlineUser, HiOutlineMail, HiOutlinePhone, HiOutlineShieldCheck,
  HiOutlineOfficeBuilding, HiOutlineLockClosed, HiOutlineEye, HiOutlineEyeOff,
  HiOutlinePencil, HiOutlineCheck, HiOutlineX,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { updateMeAPI, changePasswordAPI } from '../../services/api';

// ─── Reusable bits ────────────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle, action }) => (
  <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100">
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-1 h-9 bg-primary-600 rounded-full flex-shrink-0" />
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-gray-900 truncate">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
      </div>
    </div>
    {action}
  </div>
);

const InfoField = ({ icon: Icon, label, value, accent = 'primary' }) => {
  const palette = accent === 'primary'
    ? 'bg-primary-50 text-primary-600'
    : accent === 'emerald'
    ? 'bg-emerald-50 text-emerald-600'
    : 'bg-gray-100 text-gray-500';
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${palette}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-semibold text-gray-800 mt-0.5 break-words">{value || '—'}</p>
      </div>
    </div>
  );
};

const LabeledInput = ({ label, icon: Icon, children }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />}
      {children}
    </div>
  </div>
);

// ─── Page ────────────────────────────────────────────────────────────────
const Profile = () => {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user?.name || '', phone: user?.phone || '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);

  if (!user) return null;

  const initials = user.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
  const roleLabel = user.role?.name || '—';
  const hospitalLabel = user.hospital?.name || 'All Hospitals (Head Office)';

  const startEdit = () => {
    setForm({ name: user.name || '', phone: user.phone || '' });
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setForm({ name: user.name || '', phone: user.phone || '' });
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    if (!/^[6-9]\d{9}$/.test(form.phone.trim())) {
      return toast.error('Enter a valid 10-digit Indian mobile number');
    }
    if (form.name.trim() === user.name && form.phone.trim() === user.phone) {
      setEditing(false);
      return;
    }
    setSavingProfile(true);
    try {
      const { data } = await updateMeAPI({ name: form.name.trim(), phone: form.phone.trim() });
      updateUser({ name: data.name, phone: data.phone });
      toast.success('Profile updated');
      setEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async (e) => {
    e.preventDefault();
    if (!pw.currentPassword || !pw.newPassword) return toast.error('All fields are required');
    if (pw.newPassword.length < 6) return toast.error('New password must be at least 6 characters');
    if (pw.newPassword !== pw.confirmPassword) return toast.error('New passwords do not match');
    if (pw.newPassword === pw.currentPassword) return toast.error('New password must be different');
    setSavingPw(true);
    try {
      await changePasswordAPI({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      toast.success('Password changed successfully');
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPw({ current: false, next: false, confirm: false });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password');
    } finally {
      setSavingPw(false);
    }
  };

  const PwInput = ({ field, value, onChange, autoComplete }) => (
    <div className="relative">
      <HiOutlineLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
      <input
        type={showPw[field] ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      />
      <button
        type="button"
        onClick={() => setShowPw(s => ({ ...s, [field]: !s[field] }))}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100"
        tabIndex={-1}
      >
        {showPw[field] ? <HiOutlineEyeOff className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
      </button>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* ── Hero ──────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary-700 via-primary-500 to-primary-400" />
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-200/60 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-2xl font-bold tracking-tight">{initials}</span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">{user.name}</h2>
              <p className="text-sm text-gray-500 truncate mt-0.5">{user.email}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary-50 text-primary-700 border border-primary-100">
                  <HiOutlineShieldCheck className="w-3.5 h-3.5" />
                  {roleLabel}
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                  <HiOutlineOfficeBuilding className="w-3.5 h-3.5" />
                  {hospitalLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Personal Information ──────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <SectionHeader
          title="Personal Information"
          subtitle="Update your name and contact number"
          action={!editing && (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 rounded-lg font-medium text-gray-600 transition-colors">
              <HiOutlinePencil className="w-4 h-4" /> Edit
            </button>
          )}
        />

        {editing ? (
          <form onSubmit={handleProfileSave} className="p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LabeledInput label="Full Name" icon={HiOutlineUser}>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </LabeledInput>
              <LabeledInput label="Mobile Number" icon={HiOutlinePhone}>
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  inputMode="tel"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </LabeledInput>
            </div>

            <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Managed by Administrator</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-gray-400">Email:</span> <span className="text-gray-700 font-medium">{user.email}</span></div>
                <div><span className="text-gray-400">Role:</span> <span className="text-gray-700 font-medium">{roleLabel}</span></div>
                <div className="sm:col-span-2"><span className="text-gray-400">Hospital:</span> <span className="text-gray-700 font-medium">{hospitalLabel}</span></div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={cancelEdit} disabled={savingProfile}
                className="flex items-center gap-1 px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50">
                <HiOutlineX className="w-4 h-4" /> Cancel
              </button>
              <button type="submit" disabled={savingProfile}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm shadow-primary-200">
                {savingProfile
                  ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                  : <><HiOutlineCheck className="w-4 h-4" /> Save Changes</>}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              <InfoField icon={HiOutlineUser}  label="Full Name"     value={user.name} />
              <InfoField icon={HiOutlinePhone} label="Mobile Number" value={user.phone} />
              <InfoField icon={HiOutlineMail}  label="Email"         value={user.email} />
              <InfoField icon={HiOutlineShieldCheck}    label="Role"     value={roleLabel} accent="emerald" />
              <div className="sm:col-span-2">
                <InfoField icon={HiOutlineOfficeBuilding} label="Hospital" value={hospitalLabel} accent="emerald" />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <HiOutlineShieldCheck className="w-3.5 h-3.5" />
              <span>Email, role, and hospital can only be changed by an administrator.</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Change Password ───────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <SectionHeader
          title="Change Password"
          subtitle="Use a strong password you don't reuse elsewhere"
        />
        <form onSubmit={handlePasswordSave} className="p-5 sm:p-6 space-y-4" autoComplete="off">
          <LabeledInput label="Current Password">
            <PwInput
              field="current"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
              autoComplete="current-password"
            />
          </LabeledInput>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LabeledInput label="New Password">
              <PwInput
                field="next"
                value={pw.newPassword}
                onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                autoComplete="new-password"
              />
            </LabeledInput>
            <LabeledInput label="Confirm New Password">
              <PwInput
                field="confirm"
                value={pw.confirmPassword}
                onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })}
                autoComplete="new-password"
              />
            </LabeledInput>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <HiOutlineLockClosed className="w-3.5 h-3.5" />
              Minimum 6 characters · must differ from current password
            </p>
            <button type="submit" disabled={savingPw}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50 shadow-sm shadow-primary-200">
              {savingPw
                ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Updating…</>
                : <><HiOutlineLockClosed className="w-4 h-4" /> Change Password</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Profile;
