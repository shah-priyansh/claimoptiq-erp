import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { loginAPI, getPublicStatsAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { isValidIdentifier, inputCls } from '../../utils/validators';
import { HiOutlineEye, HiOutlineEyeOff } from 'react-icons/hi';

const CountUp = ({ value, duration = 1600, slowTail = 6 }) => {
  const match = String(value ?? '').match(/^(\d[\d,]*)(.*)$/);
  const target = match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
  const suffix = match ? match[2] : '';
  const [count, setCount] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!target || target <= 0) {
      setCount(0);
      return;
    }
    const tail = Math.min(slowTail, target);
    const tailStart = target - tail;
    const fastDuration = duration * 0.45;
    const slowDuration = duration * 0.85;
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      let v;
      if (elapsed <= fastDuration) {
        const t = elapsed / fastDuration;
        const eased = 1 - Math.pow(1 - t, 2);
        v = Math.floor(eased * tailStart);
      } else if (elapsed <= fastDuration + slowDuration) {
        const t = (elapsed - fastDuration) / slowDuration;
        const eased = 1 - Math.pow(1 - t, 3);
        v = tailStart + Math.floor(eased * tail);
      } else {
        v = target;
      }
      v = Math.min(v, target);
      setCount(v);
      if (v < target) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => rafRef.current && cancelAnimationFrame(rafRef.current);
  }, [target, duration, slowTail]);

  if (!target) {
    return (
      <span className="inline-block h-7 w-20 rounded bg-white/20 animate-pulse align-middle" />
    );
  }
  return <>{count.toLocaleString()}{suffix}</>;
};

const Login = () => {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [stats, setStats] = useState({});

  useEffect(() => {
    getPublicStatsAPI().then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  if (user) return <Navigate to="/dashboard" replace />;

  const validate = () => {
    const e = {};
    if (!form.identifier.trim()) {
      e.identifier = 'Email or mobile number is required';
    } else if (!isValidIdentifier(form.identifier)) {
      e.identifier = 'Enter a valid email or 10-digit Indian mobile number';
    }
    if (!form.password) e.password = 'Password is required';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const e_ = validate();
    if (Object.keys(e_).length) { setErrors(e_); return; }
    setLoading(true);
    try {
      const { data } = await loginAPI(form);
      login(data.token, data.user);
      toast.success('Login successful!');
      navigate('/dashboard');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const set = (field, val) => {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => ({ ...e, [field]: '' }));
  };

  return (
    <div className="min-h-screen flex">
      {/* Left - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-700 via-primary-600 to-primary-800 items-center justify-center p-12">
        <div className="text-center text-white">
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-4xl font-bold text-white">C</span>
          </div>
          <h1 className="text-4xl font-bold mb-4">{stats.login_title || 'ClaimOptiq'}</h1>
          <p className="text-xl text-primary-100 mb-2">{stats.login_subtitle || 'AI ERP Suite'}</p>
          <p className="text-primary-200 text-sm max-w-md">
            {stats.login_tagline || 'AI-Powered Healthcare Business Operating System by First Care Consultancy'}
          </p>
          <div className="mt-10 grid grid-cols-2 gap-4 text-sm text-primary-100">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-2xl font-bold text-white tabular-nums">
                <CountUp value={stats.login_stat_claims} />
              </p>
              <p>Claims Managed</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-2xl font-bold text-white tabular-nums">
                <CountUp value={stats.login_stat_hospitals} />
              </p>
              <p>Hospitals</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right - Login Form */}
      <div className="flex-1 relative flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-white">C</span>
            </div>
            <h1 className="text-2xl font-bold text-primary-800">ClaimOptiq</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-1">Sign In</h2>
            <p className="text-gray-500 text-sm mb-6">Enter your credentials to continue</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email or Mobile Number</label>
                <input
                  type="text"
                  value={form.identifier}
                  onChange={(e) => set('identifier', e.target.value)}
                  className={`px-4 py-2.5 text-sm ${inputCls(!!errors.identifier)}`}
                  placeholder="Email or 10-digit mobile"
                />
                {errors.identifier && <p className="text-xs text-red-500 mt-1">{errors.identifier}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    className={`px-4 py-2.5 pr-11 text-sm ${inputCls(!!errors.password)}`}
                    placeholder="Enter your password"
                    autoComplete="current-password"
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

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            First Care Consultancy &copy; 2026. All rights reserved.
          </p>
        </div>

        {/* Bottom disclaimer */}
        {stats.login_disclaimer && (
          <div className="absolute bottom-0 left-0 right-0 px-6 py-5 flex items-start gap-3">
            <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <p className="text-xs text-amber-600 leading-relaxed">{stats.login_disclaimer}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
