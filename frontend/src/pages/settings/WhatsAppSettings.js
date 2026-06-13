import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getWhatsAppStatusAPI,
  connectWhatsAppAPI,
  disconnectWhatsAppAPI,
} from '../../services/api';

const POLL_INTERVAL_MS = 2000;

const WhatsAppSettings = () => {
  const [status, setStatus] = useState({ connected: false, qr: null, phoneNumber: null });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const { data } = await getWhatsAppStatusAPI();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
    return stopPolling;
  }, []);

  useEffect(() => {
    if (status.connected) stopPolling();
  }, [status.connected]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data } = await connectWhatsAppAPI();
      setStatus(data);
      startPolling();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (silent = false) => {
    if (!silent && !window.confirm('Disconnect WhatsApp? You will need to scan a new QR to reconnect.')) return;
    setDisconnecting(true);
    stopPolling();
    try {
      await disconnectWhatsAppAPI();
      setStatus({ connected: false, qr: null, phoneNumber: null });
      if (!silent) toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-gray-700">WhatsApp Integration</h2>
            <p className="text-xs text-gray-400 mt-0.5">Link a phone to send claim communications via WhatsApp.</p>
          </div>
          {status.connected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Disconnected
            </span>
          )}
        </div>

        {status.connected ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Linked phone</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">+{status.phoneNumber || '—'}</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {status.qr ? (
              <>
                <div className="flex flex-col items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <img src={status.qr} alt="WhatsApp QR" className="w-64 h-64" />
                  <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                    <li>Open WhatsApp on your phone</li>
                    <li>Tap <span className="font-semibold">Settings → Linked Devices</span></li>
                    <li>Tap <span className="font-semibold">Link a device</span> and scan this QR</li>
                  </ol>
                </div>
                <button
                  type="button"
                  onClick={() => handleDisconnect(true)}
                  disabled={disconnecting}
                  className="text-xs text-gray-500 hover:text-gray-700 underline disabled:opacity-50"
                >
                  {disconnecting ? 'Resetting...' : 'Cancel / reset connection'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {connecting ? 'Starting...' : 'Connect'}
              </button>
            )}
          </div>
        )}

        <p className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 italic">
          Uses the unofficial WhatsApp Web protocol. Send only transactional messages to your customers — bulk sending can get the number banned.
        </p>
      </div>
    </div>
  );
};

export default WhatsAppSettings;
