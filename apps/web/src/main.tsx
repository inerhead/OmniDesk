import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import '@/shared/config/env';
import { bindKeyboardInset } from '@/shared/pwa/keyboard-inset';
import { bindResumeScreen } from '@/shared/pwa/resume-screen';
import { startThemeSync } from '@/shared/theme/theme-store';
import { Providers } from './app/providers';
import { router } from './app/router';
import './index.css';

startThemeSync();
bindKeyboardInset();
bindResumeScreen();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
