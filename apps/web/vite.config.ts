import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { parseWebEnv } from './src/shared/config/env-schema.ts';

// `localhost` para Caddy; `.gastromesa.com` para el túnel con dominio fijo.
const allowedHosts = ['localhost', '.trycloudflare.com', '.gastromesa.com'];

/** Google lee el HTML sin ejecutar la SPA. Estas rutas responden el archivo de `public/`. */
function legalPages(base: string): Plugin {
  const root = fileURLToPath(new URL('./public', import.meta.url));
  const pages: Record<string, string> = {
    [`${base}privacidad`]: 'privacidad.html',
    [`${base}privacidad/`]: 'privacidad.html',
    [`${base}terminos`]: 'terminos.html',
    [`${base}terminos/`]: 'terminos.html',
  };
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const file = pages[req.url?.split('?')[0] ?? ''];
    if (!file) {
      next();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(resolve(root, file)));
  };
  return {
    name: 'omnidesk-legal-pages',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  // Un VITE_API_URL o BASE_PATH inválido hace fallar `vite build` y `vite dev`.
  const { BASE_PATH } = parseWebEnv(loadEnv(mode, process.cwd(), ['VITE_', 'BASE_PATH']));
  const base = `${BASE_PATH}/`;

  return {
    // La app se sirve bajo la subruta (/omnidesk/) también en local.
    base,
    plugins: [
      legalPages(base),
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
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
        injectManifest: {
          // Solo el app shell (incluida la fuente Inter, para que funcione sin conexión).
          // Las respuestas del API nunca se cachean.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        },
        // En desarrollo también hay service worker: el escritorio en localhost puede suscribirse.
        devOptions: { enabled: true, type: 'module' },
      }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts,
      // El iPhone (Safari y la app del inicio) se queda con la página anterior.
      headers: { 'Cache-Control': 'no-store' },
    },
    preview: { host: true, port: 4173, strictPort: true, allowedHosts },
  };
});
