import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AcceptInvite } from './pages/AcceptInvite';
import { Approvals } from './pages/Approvals';
import { AssetDetailPage, AssetQrLink } from './pages/AssetDetail';
import { AuditDetailPage } from './pages/AuditDetail';
import { Audits } from './pages/Audits';
import { Imports } from './pages/Imports';
import { AssetForm } from './pages/AssetForm';
import { AssetsList } from './pages/AssetsList';
import { Custody } from './pages/Custody';
import { Dashboard } from './pages/Dashboard';
import { Integrations } from './pages/Integrations';
import { Locations } from './pages/Locations';
import { Login } from './pages/Login';
import { Maintenance } from './pages/Maintenance';
import { NotFound } from './pages/NotFound';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Warranties } from './pages/Warranties';
import { Team } from './pages/Team';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* AppLayout gates all nested routes behind the session probe. */}
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="assets" element={<AssetsList />} />
        <Route path="assets/new" element={<AssetForm />} />
        <Route path="assets/:assetId" element={<AssetDetailPage />} />
        <Route path="assets/:assetId/edit" element={<AssetForm />} />
        <Route path="asset-qr/:workspaceId/:assetId" element={<AssetQrLink />} />
        <Route path="locations" element={<Locations />} />
        <Route path="custody" element={<Custody />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="warranties" element={<Warranties />} />
        <Route path="audits" element={<Audits />} />
        <Route path="audits/:auditId" element={<AuditDetailPage />} />
        <Route path="imports" element={<Imports />} />
        <Route path="reports" element={<Reports />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="team" element={<Team />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route path="/accept-invite" element={<AcceptInvite />} />
    </Routes>
  );
}
