import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { StoreProvider } from '@/lib/store';
import { AuditPage } from '@/pages/AuditPage';
import { DashboardPage } from '@/pages/Dashboard';
import { DiscrepanciesPage } from '@/pages/DiscrepanciesPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ReviewPage } from '@/pages/ReviewPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UnnotifiedPage } from '@/pages/UnnotifiedPage';
import { UploadPage } from '@/pages/UploadPage';
import { WhatsAppPage } from '@/pages/WhatsAppPage';
import './index.css';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'upload', element: <UploadPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'employees', element: <EmployeesPage /> },
      { path: 'whatsapp', element: <WhatsAppPage /> },
      { path: 'unnotified', element: <UnnotifiedPage /> },
      { path: 'discrepancies', element: <DiscrepanciesPage /> },
      { path: 'review', element: <ReviewPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'privacy', element: <PrivacyPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
);
