import React, { createContext, useContext, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { HiOutlineExclamation, HiOutlineLogout } from 'react-icons/hi';

const ConfirmContext = createContext(null);

const ConfirmModal = ({ title, message, confirmLabel, variant, icon: Icon, onConfirm, onCancel }) => {
  const isRed = variant === 'danger';
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl shadow-black/20 w-full max-w-sm mx-auto overflow-hidden">
        {/* Top accent */}
        <div className={`h-1 w-full ${isRed ? 'bg-red-500' : 'bg-primary-600'}`} />

        <div className="p-6">
          {/* Icon */}
          <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${isRed ? 'bg-red-50' : 'bg-primary-50'}`}>
            {Icon
              ? <Icon className={`w-5 h-5 ${isRed ? 'text-red-600' : 'text-primary-600'}`} />
              : <HiOutlineExclamation className={`w-5 h-5 ${isRed ? 'text-red-600' : 'text-primary-600'}`} />
            }
          </div>

          <h3 className="text-base font-bold text-gray-900 mb-1.5">{title}</h3>
          <p className="text-sm text-gray-500 leading-relaxed">{message}</p>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-colors ${
                isRed ? 'bg-red-600 hover:bg-red-700' : 'bg-primary-600 hover:bg-primary-700'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const ConfirmProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback((message, options = {}) =>
    new Promise((resolve) => {
      setDialog({
        message,
        title:        options.title        || 'Confirm',
        confirmLabel: options.confirmLabel || 'Confirm',
        variant:      options.variant      || 'danger',
        icon:         options.icon         || null,
        resolve,
      });
    }),
  []);

  const handle = (result) => {
    dialog?.resolve(result);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <ConfirmModal
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          variant={dialog.variant}
          icon={dialog.icon}
          onConfirm={() => handle(true)}
          onCancel={() => handle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => useContext(ConfirmContext);
