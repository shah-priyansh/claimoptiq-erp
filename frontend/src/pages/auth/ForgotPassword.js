import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordAPI } from '../../services/api';
import { isValidIdentifier, inputCls } from '../../utils/validators';

const ForgotPassword = () => {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim()) { setError('Email or mobile number is required'); return; }
    if (!isValidIdentifier(identifier)) { setError('Enter a valid email or 10-digit Indian mobile number'); return; }
    setLoading(true);
    try {
      await forgotPasswordAPI({ identifier: identifier.trim() });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          {sent ? (
            <div className="text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-800 mb-2">Check your email</h2>
              <p className="text-gray-500 text-sm mb-6">
                If an account exists for that email/mobile, we've sent a password reset link.
                It's valid for 1 hour — check your inbox (and spam folder).
              </p>
              <Link
                to="/login"
                className="inline-block w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Forgot password?</h2>
              <p className="text-gray-500 text-sm mb-6">
                Enter your registered email or mobile number and we'll send you a reset link.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Email or Mobile Number</label>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => { setIdentifier(e.target.value); setError(''); }}
                    className={`px-4 py-2.5 text-sm ${inputCls(!!error)}`}
                    placeholder="Email or 10-digit mobile"
                    autoFocus
                  />
                  {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 text-sm"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-6">
                Remembered it?{' '}
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

export default ForgotPassword;
