import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import RocketLoader from './RocketLoader';
import type { UserRole } from '../types';

interface Props {
  allowedRoles?: UserRole[];
}

export default function ProtectedRoute({ allowedRoles }: Props) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <RocketLoader fullScreen />;
  }

  if (!session) return <Navigate to="/login" replace />;

  // Admin bypasses all role restrictions
  if (allowedRoles && profile && profile.role !== 'admin' && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
