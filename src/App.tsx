import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { safeRedirectPath } from '@/lib/safePath';
import { PageSpinner } from '@/components/Spinner';
import { WelcomePhotoPrompt } from '@/components/WelcomePhotoPrompt';
import { LoginPage } from '@/pages/LoginPage';
import { AppLayout } from '@/layouts/AppLayout';
import { PaddedPage } from '@/layouts/PaddedPage';
import { ClubLayout } from '@/layouts/ClubLayout';
import {
  ProjectLayout,
  ProjectIndexRedirect,
  RequirePiecesAccess,
  RequireProjectManage,
} from '@/layouts/ProjectLayout';
import { EventLayout } from '@/layouts/EventLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectOnboardingPage } from '@/pages/ProjectOnboardingPage';
import { ClubMembersPage } from '@/pages/ClubMembersPage';
import { ClubMemberDetailPage } from '@/pages/ClubMemberDetailPage';
import { ClubApplicationsPage } from '@/pages/ClubApplicationsPage';
import { ClubRulesPage } from '@/pages/ClubRulesPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { AdminConfigPage } from '@/pages/AdminConfigPage';
import { AccountPage } from '@/pages/AccountPage';
import { EventsPage } from '@/pages/EventsPage';
import { MembersPage } from '@/pages/MembersPage';
import { AbsencesPage } from '@/pages/AbsencesPage';
import { StatisticsPage } from '@/pages/StatisticsPage';
import { MemberDetailPage } from '@/pages/MemberDetailPage';
import { ProjectSettingsPage } from '@/pages/ProjectSettingsPage';
import { MyParticipationPage } from '@/pages/MyParticipationPage';
import { EventAttendancePage } from '@/pages/EventAttendancePage';
import { EventSettingsPage } from '@/pages/EventSettingsPage';
import { EventCheckinPage } from '@/pages/EventCheckinPage';
import { RegistrationsPage } from '@/pages/RegistrationsPage';
import { PiecesPage } from '@/pages/PiecesPage';
import { PieceDetailPage } from '@/pages/PieceDetailPage';
import { PiecePracticePage } from '@/pages/PiecePracticePage';
import { RegistrationPageDetail } from '@/pages/RegistrationPageDetail';
import { RegistrationPageSettings } from '@/pages/RegistrationPageSettings';
import { GroupsPage } from '@/pages/GroupsPage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { PublicCheckinPage } from '@/pages/PublicCheckinPage';
import { PublicRegistrationPage } from '@/pages/PublicRegistrationPage';
import { MfaSetupGate } from '@/pages/MfaSetupGate';

export const App = () => {
  const { session, loading, mfaSetupRequired } = useAuth();
  const location = useLocation();

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

  if (mfaSetupRequired) return <MfaSetupGate />;

  // Every account lands on the projects list; participants only see the
  // projects they belong to (enforced by RLS), managers/admins see everything.
  const homePath = '/';

  // After signing in the user is still on /login; return them to the page
  // they originally requested (carried via router state), if any.
  const from = safeRedirectPath((location.state as { from?: string } | null)?.from);

  return (
    <>
      <WelcomePhotoPrompt />
      <Routes>
        <Route path="/login" element={<Navigate to={from ?? homePath} replace />} />

        {/* Top-level workspace */}
        <Route element={<AppLayout />}>
          <Route element={<PaddedPage />}>
            <Route index element={<ProjectsPage />} />
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

        {/* Admin-only administration — isolated in its own sidebar layout. */}
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:userId" element={<UserDetailPage />} />
          <Route path="config" element={<AdminConfigPage />} />
        </Route>

        {/* Full-screen wizard for creating a project. */}
        <Route path="projects/new" element={<ProjectOnboardingPage />} />

        {/* Inside a project. Access (manager vs. participant) is resolved in the
            layout; management pages are additionally wrapped in a guard. */}
        <Route path="projects/:projectId" element={<ProjectLayout />}>
          <Route index element={<ProjectIndexRedirect />} />
          <Route path="participation" element={<MyParticipationPage />} />
          <Route element={<RequirePiecesAccess />}>
            <Route path="pieces" element={<PiecesPage />} />
            <Route path="pieces/:pieceId" element={<PieceDetailPage />} />
            <Route path="pieces/:pieceId/practice/:blockId" element={<PiecePracticePage />} />
          </Route>
          <Route element={<RequireProjectManage />}>
            <Route path="events" element={<EventsPage />} />
            <Route path="members" element={<MembersPage />} />
            <Route path="absences" element={<AbsencesPage />} />
            <Route path="statistics" element={<StatisticsPage />} />
            <Route path="registrations" element={<RegistrationsPage />} />
            <Route path="registrations/:pageId" element={<RegistrationPageDetail />} />
            <Route path="registrations/:pageId/settings" element={<RegistrationPageSettings />} />
            <Route path="members/:memberId" element={<MemberDetailPage />} />
            <Route path="groups" element={<GroupsPage />} />
            <Route path="groups/:groupId" element={<GroupDetailPage />} />
            <Route path="settings" element={<ProjectSettingsPage />} />
          </Route>
        </Route>

        {/* Inside a single event — its own sidebar layout (management only) */}
        <Route path="projects/:projectId/events/:eventId" element={<EventLayout />}>
          <Route index element={<EventAttendancePage />} />
          <Route path="check-in" element={<EventCheckinPage />} />
          <Route path="settings" element={<EventSettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
    </>
  );
};
