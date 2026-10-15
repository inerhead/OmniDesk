import { ChannelsPage } from '@/features/channels/channels-page';
import { CompanyPage } from '@/features/company/company-page';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { PlatformPage } from '@/features/platform/platform-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { createBrowserRouter, Navigate } from 'react-router';
import { AuthGate, RequireActiveTenant } from '@/features/auth/ui/auth-gate';
import { LoginPage } from '@/features/auth/ui/login-page';
import { OnboardingPage } from '@/features/auth/ui/onboarding-page';
import { InvitePage } from '@/features/team/ui/invite-page';
import { MembersPage } from '@/features/team/ui/members-page';
import { ConversationPage, ConversationPlaceholder } from '@/pages/conversation-page';
import { ConversationsPage } from '@/pages/conversations-page';
import { PrivacyPage, TermsPage } from '@/pages/legal-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { StatusPage } from '@/pages/status-page';
import { basePath } from '@/shared/config/env';
import { AppLayout } from './app-layout';

export const router = createBrowserRouter(
  [
    // Públicas.
    { path: '/login', element: <LoginPage /> },
    { path: '/privacidad', element: <PrivacyPage /> },
    { path: '/terminos', element: <TermsPage /> },
    { path: '/invite/:token', element: <InvitePage /> },
    // Con sesión (`GET /me`); un 401 redirige a /login?next=.
    {
      element: <AuthGate />,
      children: [
        { path: '/onboarding', element: <OnboardingPage /> },
        // Admin de plataforma (SPEC 18): no necesita empresa activa.
        { path: '/platform', element: <PlatformPage /> },
        {
          path: '/',
          element: (
            <RequireActiveTenant>
              <AppLayout />
            </RequireActiveTenant>
          ),
          children: [
            { index: true, element: <Navigate to="/conversations" replace /> },
            {
              path: 'conversations',
              element: <ConversationsPage />,
              children: [
                { index: true, element: <ConversationPlaceholder /> },
                { path: ':conversationId', element: <ConversationPage /> },
              ],
            },
            { path: 'status', element: <StatusPage /> },
            { path: 'settings/members', element: <MembersPage /> },
            { path: 'settings/channels', element: <ChannelsPage /> },
            { path: 'settings/company', element: <CompanyPage /> },
            { path: 'settings/notifications', element: <NotificationsPage /> },
            { path: 'settings/profile', element: <ProfilePage /> },
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ],
  // La app vive bajo la subruta (`base` de Vite): las rutas de aquí no la incluyen.
  { basename: basePath || '/' },
);
