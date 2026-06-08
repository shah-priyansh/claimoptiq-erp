import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HiOutlineBell, HiOutlineCheck, HiOutlineDocumentText,
  HiOutlineRefresh, HiOutlineInboxIn, HiOutlineExternalLink,
} from 'react-icons/hi';
import { getNotificationsAPI, markNotificationReadAPI, markAllNotificationsReadAPI } from '../../services/api';

const TYPE_META = {
  document_uploaded:       { label: 'Document Uploaded', icon: HiOutlineInboxIn,    palette: 'bg-blue-50 text-blue-600 ring-blue-100' },
  document_status_changed: { label: 'Status Updated',    icon: HiOutlineRefresh,    palette: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
};

const DEFAULT_META = { label: 'Notification', icon: HiOutlineDocumentText, palette: 'bg-gray-50 text-gray-500 ring-gray-100' };

const NotificationBell = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef(null);

  const fetchNotifications = useCallback(() => {
    getNotificationsAPI()
      .then((res) => {
        setNotifications(res.data.notifications || []);
        setUnreadCount(res.data.unreadCount || 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMarkRead = async (id) => {
    await markNotificationReadAPI(id).catch(() => {});
    setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
  };

  const handleClick = async (n) => {
    if (!n.isRead) await handleMarkRead(n._id);
    if (n.referenceId) {
      setOpen(false);
      navigate(`/documents/inbox?submissionId=${n.referenceId}`);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsReadAPI().catch(() => {});
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
  };

  const timeAgo = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
        title="Notifications"
      >
        <HiOutlineBell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-2 top-[68px] sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[400px] bg-white border border-gray-100 rounded-2xl shadow-xl shadow-gray-200/60 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 bg-gradient-to-b from-gray-50/60 to-white">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-1 h-9 bg-primary-600 rounded-full flex-shrink-0" />
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm leading-none">Notifications</h3>
                <p className="text-[11px] text-gray-400 mt-1 leading-none">
                  {unreadCount > 0 ? `${unreadCount} unread` : 'You\'re all caught up'}
                </p>
              </div>
            </div>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors flex-shrink-0"
              >
                <HiOutlineCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[60vh] sm:max-h-[420px] overflow-y-auto overscroll-contain">
            {notifications.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="w-12 h-12 mx-auto bg-gray-50 rounded-2xl flex items-center justify-center mb-3">
                  <HiOutlineBell className="w-6 h-6 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-700">No notifications yet</p>
                <p className="text-xs text-gray-400 mt-1">We'll let you know when something happens</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map((n) => {
                  const meta = TYPE_META[n.type] || DEFAULT_META;
                  const Icon = meta.icon;
                  return (
                    <button
                      key={n._id}
                      onClick={() => handleClick(n)}
                      className={`w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-gray-50 transition-colors relative ${!n.isRead ? 'bg-primary-50/40' : ''}`}
                    >
                      {!n.isRead && (
                        <span className="absolute left-0 top-3 bottom-3 w-0.5 bg-primary-500 rounded-r-full" />
                      )}
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-1 ${meta.palette}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-xs font-semibold tracking-tight flex items-center gap-1 ${!n.isRead ? 'text-primary-700' : 'text-gray-600'}`}>
                            {meta.label}
                            {n.referenceId && (
                              <HiOutlineExternalLink className="w-3 h-3 text-gray-400" title="Click to open" />
                            )}
                          </p>
                          <span className="text-[10px] font-medium text-gray-400 whitespace-nowrap flex-shrink-0 mt-0.5">
                            {timeAgo(n.createdAt)}
                          </span>
                        </div>
                        <p
                          className="text-xs text-gray-600 mt-1 leading-relaxed break-words"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={n.message}
                        >
                          {n.message}
                        </p>
                      </div>
                      {!n.isRead && <span className="absolute right-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
