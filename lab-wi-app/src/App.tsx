import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StepLibraryPage from './pages/StepLibraryPage';
import WorkInstructionsListPage from './pages/WorkInstructionsListPage';
import WorkInstructionEditorPage from './pages/WorkInstructionEditorPage';
import WorkInstructionDetailPage from './pages/WorkInstructionDetailPage';
import ProductionOrdersListPage from './pages/ProductionOrdersListPage';
import ProductionOrderNewPage from './pages/ProductionOrderNewPage';
import ProductionOrderExecutionPage from './pages/ProductionOrderExecutionPage';
import ProductionOrderCertificatePage from './pages/ProductionOrderCertificatePage';
import ReagentItemsPage from './pages/ReagentItemsPage';
import InventoryPage from './pages/InventoryPage';
import ScalesPage from './pages/ScalesPage';
import UsersPage from './pages/UsersPage';
import LabsPage from './pages/LabsPage';
import ReagentOrdersListPage from './pages/ReagentOrdersListPage';
import ReagentOrderNewPage from './pages/ReagentOrderNewPage';
import ReagentDeliveryPage from './pages/ReagentDeliveryPage';
import ReagentOrderDetailPage from './pages/ReagentOrderDetailPage';
import UnscheduledOrdersPage from './pages/UnscheduledOrdersPage';
import PlannedProductionOrdersPage from './pages/PlannedProductionOrdersPage';
import RocketLoader from './components/RocketLoader';

// Charts (recharts) are heavy and only used here — load this route lazily so a
// failure or the library's weight can't take down the rest of the app on boot.
const QualityTrendsPage = lazy(() => import('./pages/QualityTrendsPage'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver']} />}>
                  <Route path="/library" element={<StepLibraryPage />} />
                </Route>
                <Route path="/work-instructions" element={<WorkInstructionsListPage />} />
                <Route path="/work-instructions/:id" element={<WorkInstructionDetailPage />} />
                <Route element={<ProtectedRoute allowedRoles={['author', 'admin']} />}>
                  <Route path="/work-instructions/new" element={<WorkInstructionEditorPage />} />
                  <Route path="/work-instructions/:id/edit" element={<WorkInstructionEditorPage />} />
                </Route>
                <Route path="/production-orders" element={<ProductionOrdersListPage />} />
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver']} />}>
                  <Route path="/production-orders/new" element={<ProductionOrderNewPage />} />
                </Route>
                <Route path="/production-orders/:id" element={<ProductionOrderExecutionPage />} />
                <Route path="/production-orders/:id/certificate" element={<ProductionOrderCertificatePage />} />
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver']} />}>
                  <Route path="/quality-trends" element={
                    <Suspense fallback={<RocketLoader />}>
                      <QualityTrendsPage />
                    </Suspense>
                  } />
                  <Route path="/inventory" element={<InventoryPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver', 'operator', 'lab']} />}>
                  <Route path="/reagent-orders" element={<ReagentOrdersListPage />} />
                  <Route path="/reagent-orders/:id" element={<ReagentOrderDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver', 'lab']} />}>
                  <Route path="/reagent-orders/new" element={<ReagentOrderNewPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['author', 'approver', 'operator']} />}>
                  <Route path="/reagent-orders/deliver" element={<ReagentDeliveryPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['admin', 'author']} />}>
                  <Route path="/reagents" element={<ReagentItemsPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['approver']} />}>
                  <Route path="/planned-orders" element={<PlannedProductionOrdersPage />} />
                </Route>
                <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
                  <Route path="/scales" element={<ScalesPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/labs" element={<LabsPage />} />
                  <Route path="/unscheduled-orders" element={<UnscheduledOrdersPage />} />
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}