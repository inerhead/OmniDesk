import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { parseWebEnv } from './src/shared/config/env-schema.ts';

// `localhost` para Caddy y escritorio; `.trycloudflare.com` para el túnel HTTPS hacia el celular.
const allowedHosts = ['localhost', '.trycloudflare.com'];

export default defineConfig(({ mode }) => {
  // Un VITE_API_URL o BASE_PATH inválido hace fallar `vite build` y `vite dev`.
  const { BASE_PATH } = parseWebEnv(loadEnv(mode, process.cwd(), ['VITE_', 'BASE_PATH']));
  const base = `${BASE_PATH}/`;
  const escapedBase = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  return {
    // La app se sirve bajo la subruta (/omnidesk/) también en local.
    base,
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        // El registro lo hace `useRegisterSW` en UpdatePrompt.
        injectRegister: false,
        includeAssets: ['favicon.ico', 'logo.svg', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'OmniDesk',
          short_name: 'OmniDesk',
          description: 'Supervisión de conversaciones atendidas por IA y agentes humanos.',
          lang: 'es',
          start_url: base,
          scope: base,
          display: 'standalone',
          theme_color: '#0f172a',
          background_color: '#ffffff',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Solo el app shell (incluida la fuente Inter, para que funcione sin conexión).
          // Las respuestas del API nunca se cachean (sin runtimeCaching).
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          navigateFallback: `${base}index.html`,
          navigateFallbackDenylist: [new RegExp(`^${escapedBase}/api/`)],
          cleanupOutdatedCaches: true,
        },
        // Sin service worker en `vite dev`: la PWA se verifica con el build (web-preview).
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { host: true, port: 5173, strictPort: true, allowedHosts },
    preview: { host: true, port: 4173, strictPort: true, allowedHosts },
  };
});
