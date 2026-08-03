import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { resetPasswordAPI } from '../../services/api';
import { inputCls } from '../../utils/validators';
import { HiOutlineEye, HiOutlineEyeOff } from 'react-icons/hi';

const ResetPassword = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [form, setForm] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (field, val) => {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => ({ ...e, [field]: '' }));
    setFormError('');
  };

  const validate = () => {
    const e = {};
    if (!form.password) e.password = 'New password is required';
    else if (form.password.length < 6) e.password = 'Password must be at least 6 characters';
    if (!form.confirm) e.confirm = 'Please confirm your password';
    else if (form.password && form.confirm !== form.password) e.confirm = 'Passwords do not match';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    const e_ = validate();
    if (Object.keys(e_).length) { setErrors(e_); return; }
    setLoading(true);
    try {
      await resetPasswordAPI({ token, password: form.password });
      toast.success('Password reset successfully! Please sign in.');
      navigate('/login');
    } catch (err) {
      setFormError(err.response?.data?.message || 'Could not reset your password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  const invalidLink = !token;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl font-bold text-white">C</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-800">ClaimOptiq</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {invalidLink ? (
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-800 mb-2">Invalid reset link</h2>
              <p className="text-gray-500 text-sm mb-6">
                This password reset link is missing or malformed. Please request a new one.
              </p>
              <Link
                to="/forgot-password"
                className="inline-block w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Set a new password</h2>
              <p className="text-gray-500 text-sm mb-6">Choose a new password for your account.</p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">New Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      className={`px-4 py-2.5 pr-11 text-sm ${inputCls(!!errors.password)}`}
                      placeholder="At least 6 characters"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    >
                      {showPassword ? <HiOutlineEyeOff className="w-4.5 h-4.5" /> : <HiOutlineEye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)}
                    className={`px-4 py-2.5 text-sm ${inputCls(!!errors.confirm)}`}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                  {errors.confirm && <p className="text-xs text-red-500 mt-1">{errors.confirm}</p>}
                </div>

                {formError && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                    <p className="text-xs text-red-600">{formError}</p>
                    <Link to="/forgot-password" className="text-xs font-medium text-primary-600 hover:underline">
                      Request a new link
                    </Link>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 text-sm"
                >
                  {loading ? 'Resetting...' : 'Reset password'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-6">
                <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700 hover:underline">
                  Back to Sign In
                </Link>
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          First Care Consultancy &copy; 2026. All rights reserved.
        </p>
      </div>
    </div>
  );
};

export default ResetPassword;
