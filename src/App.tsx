import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { safeRedirectPath } from '@/lib/safePath';
import { PageSpinner } from '@/components/Spinner';
import { LoginPage } from '@/pages/LoginPage';
import { AppLayout } from '@/layouts/AppLayout';
import { PaddedPage } from '@/layouts/PaddedPage';
import { ClubLayout } from '@/layouts/ClubLayout';
import { ProjectLayout } from '@/layouts/ProjectLayout';
import { EventLayout } from '@/layouts/EventLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ClubMembersPage } from '@/pages/ClubMembersPage';
import { ClubMemberDetailPage } from '@/pages/ClubMemberDetailPage';
import { ClubApplicationsPage } from '@/pages/ClubApplicationsPage';
import { ClubRulesPage } from '@/pages/ClubRulesPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { AccountPage } from '@/pages/AccountPage';
import { EventsPage } from '@/pages/EventsPage';
import { MembersPage } from '@/pages/MembersPage';
import { AbsencesPage } from '@/pages/AbsencesPage';
import { StatisticsPage } from '@/pages/StatisticsPage';
import { MemberDetailPage } from '@/pages/MemberDetailPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { EventAttendancePage } from '@/pages/EventAttendancePage';
import { EventSettingsPage } from '@/pages/EventSettingsPage';
import { EventCheckinPage } from '@/pages/EventCheckinPage';
import { RegistrationsPage } from '@/pages/RegistrationsPage';
import { PiecesPage } from '@/pages/PiecesPage';
import { PieceDetailPage } from '@/pages/PieceDetailPage';
import { PiecePracticePage } from '@/pages/PiecePracticePage';
import { RegistrationPageDetail } from '@/pages/RegistrationPageDetail';
import { PublicCheckinPage } from '@/pages/PublicCheckinPage';
import { PublicRegistrationPage } from '@/pages/PublicRegistrationPage';
import { NotConfiguredPage } from '@/pages/NotConfiguredPage';

export const App = () => {
  const { session, loading, canAccessProjects, canAccessClub } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) return <NotConfiguredPage />;
  if (
    location.pathname.startsWith('/check-in/') ||
    location.pathname.startsWith('/register/')
  ) {
    return (
      <Routes>
        <Route path="/check-in/:token" element={<PublicCheckinPage />} />
        <Route path="/register/:token" element={<PublicRegistrationPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  if (loading) return <PageSpinner />;
  if (!session) {
    // Remember where the user wanted to go so the login page can send them
    // back there afterwards (e.g. when someone shares a deep link).
    const from = location.pathname + location.search + location.hash;
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from }} />} />
      </Routes>
    );
  }

  // Where to send a user who lands on a section they cannot access.
  const homePath = canAccessProjects ? '/' : canAccessClub ? '/club' : '/account';

  // After signing in the user is still on /login; return them to the page
  // they originally requested (carried via router state), if any.
  const from = safeRedirectPath((location.state as { from?: string } | null)?.from);

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={from ?? homePath} replace />} />

      {/* Top-level workspace */}
      <Route element={<AppLayout />}>
        <Route element={<PaddedPage />}>
          <Route
            index
            element={canAccessProjects ? <ProjectsPage /> : <Navigate to={homePath} replace />}
          />
          <Route path="account" element={<AccountPage />} />
        </Route>

        {/* Club members section — owns a second (nested) sidebar. */}
        <Route path="club" element={<ClubLayout />}>
          <Route index element={<Navigate to="members" replace />} />
          <Route path="members" element={<ClubMembersPage />} />
          <Route path="members/:memberId" element={<ClubMemberDetailPage />} />
          <Route path="applications" element={<ClubApplicationsPage />} />
          <Route path="rules" element={<ClubRulesPage />} />
        </Route>
      </Route>

      {/* Owner-only administration — isolated in its own sidebar layout. */}
      <Route path="admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:userId" element={<UserDetailPage />} />
      </Route>

      {/* Inside a project */}
      <Route
        path="projects/:projectId"
        element={canAccessProjects ? <ProjectLayout /> : <Navigate to={homePath} replace />}
      >
        <Route index element={<Navigate to="events" replace />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="absences" element={<AbsencesPage />} />
        <Route path="statistics" element={<StatisticsPage />} />
        <Route path="pieces" element={<PiecesPage />} />
        <Route path="pieces/:pieceId" element={<PieceDetailPage />} />
        <Route path="pieces/:pieceId/practice/:blockId" element={<PiecePracticePage />} />
        <Route path="registrations" element={<RegistrationsPage />} />
        <Route path="registrations/:pageId" element={<RegistrationPageDetail />} />
        <Route path="members/:memberId" element={<MemberDetailPage />} />
        <Route path="settings" element={<ProjectSettingsPage />} />
      </Route>

      {/* Inside a single event — its own sidebar layout */}
      <Route
        path="projects/:projectId/events/:eventId"
        element={canAccessProjects ? <EventLayout /> : <Navigate to={homePath} replace />}
      >
        <Route index element={<EventAttendancePage />} />
        <Route path="check-in" element={<EventCheckinPage />} />
        <Route path="settings" element={<EventSettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  );
};
