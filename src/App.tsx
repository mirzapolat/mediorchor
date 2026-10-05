import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Mail, UsersRound } from 'lucide-react';
import { NoAccess } from '@/components/NoAccess';
import { useAuth } from '@/hooks/useAuth';
import { safeRedirectPath } from '@/lib/safePath';
import { trackPageview } from '@/lib/analytics';
import { PageSpinner } from '@/components/Spinner';
import { WelcomePhotoPrompt } from '@/components/WelcomePhotoPrompt';
import { LoginPage } from '@/pages/LoginPage';
import { AppLayout } from '@/layouts/AppLayout';
import { PaddedPage } from '@/layouts/PaddedPage';
import { ClubLayout } from '@/layouts/ClubLayout';
import { FeaturePreviewPage } from '@/pages/FeaturePreviewPage';
import { CLUB_ENABLED } from '@/lib/features';
import {
  ProjectLayout,
  ProjectIndexRedirect,
  RequirePiecesAccess,
  RequireProjectManage,
} from '@/layouts/ProjectLayout';
import { EventLayout } from '@/layouts/EventLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { LegalPage } from '@/pages/LegalPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProjectOnboardingPage } from '@/pages/ProjectOnboardingPage';
import { ClubMembersPage } from '@/pages/ClubMembersPage';
import { ClubMemberDetailPage } from '@/pages/ClubMemberDetailPage';
import { ClubApplicationsPage } from '@/pages/ClubApplicationsPage';
import { ClubRulesPage } from '@/pages/ClubRulesPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { AdminBrandingPage, AdminLegalPage, AdminSecurityPage } from '@/pages/AdminSettingsPages';
import { AdminEmailPage } from '@/pages/AdminEmailPage';
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
import { EventProgramPage } from '@/pages/EventProgramPage';
import { EventCheckinPage } from '@/pages/EventCheckinPage';
import { RegistrationsPage } from '@/pages/RegistrationsPage';
import { PiecesPage } from '@/pages/PiecesPage';
import { GlobalPiecesPage } from '@/pages/GlobalPiecesPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { GlobalPiecesLayout } from '@/layouts/GlobalPiecesLayout';
import { PieceDetailPage } from '@/pages/PieceDetailPage';
import { PieceSetupPage } from '@/pages/PieceSetupPage';
import { RegistrationPageDetail } from '@/pages/RegistrationPageDetail';
import { RegistrationPageSettings } from '@/pages/RegistrationPageSettings';
import { GroupsPage } from '@/pages/GroupsPage';
import { GroupDetailPage } from '@/pages/GroupDetailPage';
import { PublicCheckinPage } from '@/pages/PublicCheckinPage';
import { PublicRegistrationPage } from '@/pages/PublicRegistrationPage';
import { MfaSetupGate } from '@/pages/MfaSetupGate';

// Admin-only routes; everyone else gets the no-access notice.
const RequireAdmin = () => {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <NoAccess />;
};

export const App = () => {
  const { session, loading, mfaSetupRequired } = useAuth();
  const location = useLocation();

  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);

  if (
    location.pathname.startsWith('/check-in/') ||
    location.pathname.startsWith('/register/') ||
    location.pathname === '/impressum' ||
    location.pathname === '/datenschutz'
  ) {
    return (
      <Routes>
        <Route path="/check-in/:token" element={<PublicCheckinPage />} />
        <Route path="/register/:token" element={<PublicRegistrationPage />} />
        <Route path="/impressum" element={<LegalPage kind="imprint" />} />
        <Route path="/datenschutz" element={<LegalPage kind="privacy" />} />
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
            <Route path="calendar" element={<CalendarPage />} />
          </Route>

          {/* The piece collection shared by all projects. */}
          <Route path="pieces" element={<GlobalPiecesLayout />}>
            <Route index element={<GlobalPiecesPage />} />
            <Route path=":pieceId" element={<PieceDetailPage />} />
            <Route path=":pieceId/setup" element={<PieceSetupPage />} />
          </Route>

          {/* Planned sections, shown as a notice to admins for now. */}
          <Route element={<RequireAdmin />}>
            <Route element={<PaddedPage />}>
              {!CLUB_ENABLED && (
                <Route
                  path="club/*"
                  element={
                    <FeaturePreviewPage
                      title="club"
                      icon={UsersRound}
                      intro="clubPreviewIntro"
                      ideas={['clubPreviewMembers', 'clubPreviewApplications', 'clubPreviewRules']}
                    />
                  }
                />
              )}
              <Route
                path="newsletter"
                element={
                  <FeaturePreviewPage
                    title="newsletter"
                    icon={Mail}
                    intro="newsletterPreviewIntro"
                    ideas={['newsletterPreviewProject', 'newsletterPreviewEveryone']}
                  />
                }
              />
            </Route>
          </Route>

          {/* Club members section — owns a second (nested) sidebar. */}
          {CLUB_ENABLED && (
            <Route path="club" element={<ClubLayout />}>
              <Route index element={<Navigate to="members" replace />} />
              <Route path="members" element={<ClubMembersPage />} />
              <Route path="members/:memberId" element={<ClubMemberDetailPage />} />
              <Route path="applications" element={<ClubApplicationsPage />} />
              <Route path="rules" element={<ClubRulesPage />} />
            </Route>
          )}
        </Route>

        {/* Admin-only administration — isolated in its own sidebar layout. */}
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:userId" element={<UserDetailPage />} />
          <Route path="branding" element={<AdminBrandingPage />} />
          <Route path="security" element={<AdminSecurityPage />} />
          {/* Old link to the combined settings page. */}
          <Route path="config" element={<Navigate to="/admin/security" replace />} />
          <Route path="imprint" element={<AdminLegalPage kind="imprint" />} />
          <Route path="privacy" element={<AdminLegalPage kind="privacy" />} />
          <Route path="email" element={<AdminEmailPage />} />
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
            {/* Old practice links point at a block; the piece page replaces them. */}
            <Route path="pieces/:pieceId/practice/:blockId" element={<Navigate to="../.." relative="path" replace />} />
            {/* Needs the pieces permission; the page checks it. */}
            <Route path="pieces/:pieceId/setup" element={<PieceSetupPage />} />
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
          <Route path="program" element={<EventProgramPage />} />
          <Route path="check-in" element={<EventCheckinPage />} />
          <Route path="settings" element={<EventSettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Routes>
    </>
  );
};
