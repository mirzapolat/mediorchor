import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { PageSpinner } from '@/components/Spinner';
import { LoginPage } from '@/pages/LoginPage';
import { AppLayout } from '@/layouts/AppLayout';
import { ProjectLayout } from '@/layouts/ProjectLayout';
import { EventLayout } from '@/layouts/EventLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { AccountPage } from '@/pages/AccountPage';
import { EventsPage } from '@/pages/EventsPage';
import { MembersPage } from '@/pages/MembersPage';
import { AbsencesPage } from '@/pages/AbsencesPage';
import { MemberDetailPage } from '@/pages/MemberDetailPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { EventAttendancePage } from '@/pages/EventAttendancePage';
import { EventSettingsPage } from '@/pages/EventSettingsPage';
import { EventCheckinPage } from '@/pages/EventCheckinPage';
import { PublicCheckinPage } from '@/pages/PublicCheckinPage';
import { NotConfiguredPage } from '@/pages/NotConfiguredPage';

export const App = () => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) return <NotConfiguredPage />;
  if (location.pathname.startsWith('/check-in/')) {
    return (
      <Routes>
        <Route path="/check-in/:token" element={<PublicCheckinPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (loading) return <PageSpinner />;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />

      {/* Top-level workspace */}
      <Route element={<AppLayout />}>
        <Route index element={<ProjectsPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>

      {/* Owner-only administration — isolated in its own sidebar layout. */}
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:userId" element={<UserDetailPage />} />
      </Route>

      {/* Inside a project */}
      <Route path="projects/:projectId" element={<ProjectLayout />}>
        <Route index element={<Navigate to="events" replace />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="absences" element={<AbsencesPage />} />
        <Route path="members/:memberId" element={<MemberDetailPage />} />
        <Route path="settings" element={<ProjectSettingsPage />} />
      </Route>

      {/* Inside a single event — its own sidebar layout */}
      <Route path="projects/:projectId/events/:eventId" element={<EventLayout />}>
        <Route index element={<EventAttendancePage />} />
        <Route path="check-in" element={<EventCheckinPage />} />
        <Route path="settings" element={<EventSettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
