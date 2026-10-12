import { createBrowserRouter, Navigate } from 'react-router';
import { ConversationPage, ConversationPlaceholder } from '@/pages/conversation-page';
import { ConversationsPage } from '@/pages/conversations-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { StatusPage } from '@/pages/status-page';
import { AppLayout } from './app-layout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
