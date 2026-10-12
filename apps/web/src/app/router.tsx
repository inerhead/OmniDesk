import { createBrowserRouter, Navigate } from 'react-router';
import { AuthGate, RequireActiveTenant } from '@/features/auth/ui/auth-gate';
import { LoginPage } from '@/features/auth/ui/login-page';
import { OnboardingPage } from '@/features/auth/ui/onboarding-page';
import { InvitePage } from '@/features/team/ui/invite-page';
import { MembersPage } from '@/features/team/ui/members-page';
import { ConversationPage, ConversationPlaceholder } from '@/pages/conversation-page';
import { ConversationsPage } from '@/pages/conversations-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { StatusPage } from '@/pages/status-page';
import { AppLayout } from './app-layout';

export const router = createBrowserRouter([
  // Públicas.
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  // Con sesión (`GET /me`); un 401 redirige a /login?next=.
  {
    element: <AuthGate />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
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
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
