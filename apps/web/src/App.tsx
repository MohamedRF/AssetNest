import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Audits } from './pages/Audits';
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

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="assets" element={<AssetsList />} />
        <Route path="assets/new" element={<AssetForm />} />
        <Route path="locations" element={<Locations />} />
        <Route path="custody" element={<Custody />} />
        <Route path="maintenance" element={<Maintenance />} />
        <Route path="warranties" element={<Warranties />} />
        <Route path="audits" element={<Audits />} />
        <Route path="reports" element={<Reports />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
