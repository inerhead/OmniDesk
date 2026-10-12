import { createBrowserRouter } from 'react-router';
import { HomePage } from '@/pages/home-page';
import { AppLayout } from './app-layout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <HomePage /> }],
  },
]);
