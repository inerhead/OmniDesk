// Aplica el tema antes del primer render para evitar el parpadeo en claro.
// Debe coincidir con src/shared/theme/theme-store.ts (clave, valores y colores).
// Archivo externo (no inline) para cumplir la CSP `default-src 'self'` del gateway.
/* global window, document, localStorage */
(function () {
  var pref = 'system';
  try {
    var stored = localStorage.getItem('omnidesk:theme');
    if (stored === 'light' || stored === 'dark') pref = stored;
  } catch {
    // Sin acceso a localStorage (p. ej. modo privado): se usa el tema del sistema.
  }
  var dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
  document
    .querySelector('meta[name="theme-color"]')
    .setAttribute('content', dark ? '#0e1016' : '#ffffff');
})();
