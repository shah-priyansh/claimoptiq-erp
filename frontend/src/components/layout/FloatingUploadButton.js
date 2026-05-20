import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { HiOutlineUpload } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';

const FloatingUploadButton = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { canViewModule, user } = useAuth();

  if (!canViewModule('document_submissions') || !user?.hospital) return null;
  if (location.pathname === '/documents/upload') return null;

  return (
    <button
      onClick={() => navigate('/documents/upload')}
      title="Upload documents"
      className="fixed bottom-20 right-4 z-30 lg:hidden w-14 h-14 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
    >
      <HiOutlineUpload className="w-6 h-6" />
    </button>
  );
};

export default FloatingUploadButton;
