# SPEC 10 — Robustez I: E2E con Playwright y rate limiting

> **Status:** Approved
> **Depends on:** SPEC 06, SPEC 07, SPEC 09
> **Date:** 2026-10-12
> **Objective:** Un comando `pnpm e2e` ejecuta con Playwright, en escritorio y en móvil, el escenario de extremo a extremo de la arquitectura contra un stack Docker aislado, y el API limita la tasa de peticiones por IP, sesión, miembro y credencial con contadores en Postgres, respondiendo `429` con `Retry-After`.

## Por qué existe este spec

Hasta ahora, la web se verifica con checklists manuales (SPEC 06) y el API con e2e de supertest. El ciclo completo (login → mensaje del cliente → asignar → responder → ticks) no tiene una prueba automática que pase por el navegador, y menos en viewport móvil, que es donde se usa la PWA.

Con el despliegue público (SPEC 08), los endpoints de login, invitaciones e integración quedan expuestos a internet. El rate limiting es la primera barrera contra el abuso y contra los bucles accidentales de n8n.

Estas dos piezas son las primeras de las cuatro en que se dividió el incremento "Robustez" (SPEC 10–13).

## Alcance

**Dentro:**

- **Paquete `apps/e2e`** (`@omnidesk/e2e`) con Playwright.
  - **Proyectos:**
    - `desktop-chromium`: 1280×800.
    - `mobile-chrome`: Pixel 7.
    - `mobile-safari`: iPhone 14, WebKit.
  - **Comando raíz `pnpm e2e`:**
    - Levanta (o reutiliza) un proyecto Compose aislado `omnidesk-e2e` con `docker compose -p omnidesk-e2e`.
    - Usa la base `omnidesk_e2e_ui`, el gateway en `8090`, `DEMO_MODE=true`, el canal demo `SIMULATED`, `SIMULATED_PROVIDER_FAILURE_RATE=0` y `RATE_LIMIT_ENABLED=false`.
    - Espera el healthcheck.
    - Ejecuta Playwright.
    - Deja el stack arriba para repetir. `pnpm e2e:down` lo baja y borra su volumen.
  - **Fixtures:**
    - `loginAs(page, 'Sup. Demo' | 'Laura' | 'Mateo')`, mediante el login de desarrollo (SPEC 07).
    - `customerSays(phone, text)`, que llama a `/integrations/messages/inbound` con la credencial demo.
    - `resetDatabase()`, que hace `TRUNCATE` de las tablas de conversación antes de cada archivo, por un endpoint solo de e2e (`POST /api/v1/testing/reset`, que solo existe con `E2E_TESTING=true`).
  - Los selectores son por rol y texto accesible (`getByRole`, `getByLabel`), sin `data-testid` salvo donde no haya texto.
  - **Escenarios** (`apps/e2e/tests/`):
    1. `auth.spec.ts`:
       - Sin sesión → `/login`.
       - Login demo → bandeja.
       - Cerrar sesión → `/login`.
       - Expirar la sesión (borrar la cookie) → la siguiente acción redirige a `/login?next=`.
    2. `inbox-realtime.spec.ts`: un mensaje del cliente aparece en la lista y en el chat abierto en ≤ 1 s, sin recargar.
    3. `assign-and-reply.spec.ts`, el escenario de §15, pasos 2–6:
       - Sup. Demo asigna a Laura.
       - Laura ve la conversación en **Mías**.
       - Una respuesta de IA tardía recibe `409`.
       - Laura responde, y los ticks llegan a ✓✓ azul.
       - Laura libera, y el siguiente mensaje del cliente vuelve a permitir la IA.
    4. `search.spec.ts`: búsqueda por nombre y por teléfono con espacios, y estado vacío.
    5. `mobile-navigation.spec.ts` (solo en los proyectos móviles):
       - Lista → chat → volver.
       - La barra inferior se oculta en el chat.
       - El composer está visible y dentro del viewport.
    6. `contact-panel.spec.ts`:
       - Abrir y cerrar el panel.
       - Copiar el teléfono.
       - Asignar desde el panel.
  - **Informe:** HTML de Playwright en `apps/e2e/playwright-report/` y trazas `on-first-retry`, con 1 reintento local.
- **Rate limiting** (módulo `ratelimit`):
  - Contadores de ventana fija en la tabla `rate_limit_buckets` de Postgres. El incremento es atómico (`INSERT … ON CONFLICT DO UPDATE … RETURNING count`).
  - **Políticas** (`modules/ratelimit/domain/policies.ts`):

    | Política | Rutas | Clave | Límite |
    | --- | --- | --- | --- |
    | `auth` | `/auth/google`, `/auth/google/callback`, `/auth/dev-login` | IP | 10 / min |
    | `invitation-public` | `GET`/`POST /invitations/by-token/*` | IP | 20 / min |
    | `integration` | `/integrations/messages/*` | credencial (id) | 600 / min |
    | `send-message` | `POST /conversations/:id/messages`, `…/retry` | miembro | 30 / min |
    | `session-default` | resto de rutas con sesión | sesión | 300 / min |

  - Al superar el límite:
    - Responde `429 { code: 'RATE_LIMITED', retryAfterSeconds }` con la cabecera `Retry-After`.
    - Registra un log `warn` con la política y la clave (la IP truncada a /24).
  - `/health` y `/realtime` no se limitan.
  - **Falla abierto:** si Postgres no responde al contar, la petición pasa y se registra un `error`.
  - **Purga:** cada hora se borran los buckets con `window_start` de hace más de 2 h, en un job con advisory lock.
  - `RATE_LIMIT_ENABLED=true` por defecto. `false` en los e2e.
  - **Web:** un `429` muestra el toast "Demasiadas acciones seguidas. Prueba en N s." y no reintenta automáticamente.

**Fuera de alcance (para specs futuros):**

- Ejecutar los E2E en GitHub Actions o en otro CI.
- Pruebas de regresión visual (snapshots de capturas).
- Pruebas de carga y rendimiento.
- Rate limiting por empresa o por plan.
- E2E del flujo real de Google OAuth y de n8n real.
- Métricas de rechazos (SPEC 11).

## Modelo de datos

**Prisma (nuevo):**

```prisma
model RateLimitBucket {
  /// "<política>:<clave>", p. ej. "auth:203.0.113.7" o "send-message:<memberId>".
  key         String
  windowStart DateTime @map("window_start") @db.Timestamptz(0)
  count       Int      @default(0)
  @@id([key, windowStart])
  @@index([windowStart])
  @@map("rate_limit_buckets")
}
```

**Dominio:**

```ts
type RateLimitPolicy = {
  name: 'auth' | 'invitation-public' | 'integration' | 'send-message' | 'session-default';
  limit: number;
  windowSeconds: 60;
  keyFrom: 'ip' | 'credential' | 'member' | 'session';
};
// Función pura, con pruebas:
windowStartFor(now: Date, windowSeconds: number): Date
retryAfterSeconds(now: Date, windowStart: Date, windowSeconds: number): number
```

**Contratos:** `RateLimitedErrorSchema = { code: z.literal('RATE_LIMITED'), retryAfterSeconds: z.int().min(1) }`.

**Variables de entorno:**

```
RATE_LIMIT_ENABLED=true
E2E_TESTING=false            # true solo en el stack omnidesk-e2e; prohibido con NODE_ENV=production
```

## Plan de implementación

1. **Paquete e2e vacío.**
   - `apps/e2e` con `@playwright/test`, `playwright.config.ts` (tres proyectos, `baseURL` `http://localhost:8090/omnidesk`).
   - Una prueba humo que carga `/login`.
   - Scripts `pnpm e2e` y `pnpm e2e:down`, más `infra/e2e/docker-compose.e2e.yml` (override de puertos, base y variables).
2. **Endpoint de reset y fixtures.**
   - `POST /testing/reset`, que solo se registra con `E2E_TESTING=true` (validado en `env.ts`: prohibido en producción).
   - `loginAs`, `customerSays` y `resetDatabase`.
3. **Escenarios de autenticación y tiempo real** (`auth`, `inbox-realtime`).
4. **Escenario del ciclo completo** (`assign-and-reply`), incluida la respuesta de IA tardía (`POST /outbound` con un `controlVersion` viejo → `409`).
5. **Búsqueda, navegación móvil y panel de contacto.** Si algún escenario falla por un defecto real de SPEC 06–07, se corrige el defecto, no la prueba.
6. **Rate limiting: dominio y almacenamiento.**
   - Tabla y migración.
   - `RateLimitStore` (puerto) con el adaptador Prisma.
   - Funciones puras con pruebas.
   - Prueba de integración: 20 incrementos concurrentes sobre la misma clave dan exactamente 20.
7. **Rate limiting: guard y políticas.**
   - `RateLimitGuard` global, con el decorador `@RateLimit('<política>')` en las rutas y `session-default` por defecto.
   - Falla abierto.
   - e2e del API: la petición 11 a `/auth/dev-login` en un minuto da `429` con `Retry-After`.
8. **Purga.** Job horario con advisory lock y su prueba.
9. **Web: toast de `429`.** En `http-client.ts`, con su prueba unitaria.
10. **Documentación.**
    - README: `pnpm e2e`, cómo ver el informe y las políticas de límite.
    - `docs/arquitectura.md` §5 y §14.

## Criterios de aceptación

**E2E**

- [ ] Con Docker arriba y sin otra preparación, `pnpm e2e` termina con código 0 y ejecuta los 6 archivos en los tres proyectos (el escenario móvil solo en los dos móviles).
- [ ] `pnpm e2e` no toca los datos del stack de desarrollo: las conversaciones en `http://localhost:8080` siguen iguales después.
- [ ] Ejecutar `pnpm e2e` dos veces seguidas pasa ambas veces (los datos se reinician entre archivos).
- [ ] Romper a propósito el texto "Tomar conversación para responder" hace fallar `assign-and-reply` en los tres proyectos, con traza disponible en el informe.
- [ ] `POST /api/v1/testing/reset` responde `404` en el stack de desarrollo (`E2E_TESTING=false`).
- [ ] El API no arranca con `E2E_TESTING=true` y `NODE_ENV=production`.

**Rate limiting**

- [ ] 11 `POST /auth/dev-login` desde la misma IP en un minuto: la 11.ª responde `429` con `Retry-After` entre 1 y 60.
- [ ] 31 mensajes de Laura en un minuto: el 31.º responde `429`, y la web muestra "Demasiadas acciones seguidas…".
- [ ] El límite de `send-message` de Laura no afecta a Mateo.
- [ ] 600 peticiones de integración por minuto con la credencial demo pasan, y la 601 responde `429`.
- [ ] Detrás del gateway, la IP usada como clave es la del cliente (`X-Forwarded-For` con `TRUST_PROXY`), no la de Caddy.
- [ ] Con la tabla `rate_limit_buckets` bloqueada (`LOCK TABLE … ACCESS EXCLUSIVE` en otra sesión), las peticiones pasan tras el timeout de 500 ms, y queda un log `error`.
- [ ] Una hora después, los buckets antiguos ya no están en la tabla.
- [ ] `/health` nunca responde `429`.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** Playwright en tres proyectos (Chromium de escritorio, Chrome móvil y Safari móvil). La PWA se usa sobre todo en móvil, y WebKit es el motor de iOS.
- **Sí:** solo en local, con `pnpm e2e`. Lo decidió el equipo; es coherente con el despliegue manual de SPEC 08.
- **Sí:** stack Compose aislado (`omnidesk-e2e`, puerto 8090, base propia). Los E2E nunca tocan los datos de desarrollo.
- **Sí:** login de desarrollo para los E2E. Automatizar Google OAuth es frágil y lo bloquea Google.
- **Sí:** endpoint `POST /testing/reset` protegido por la variable `E2E_TESTING`, prohibida en producción. Es más rápido y determinista que recrear el contenedor de Postgres.
- **Sí:** contadores en Postgres. Lo decidió el equipo; sobreviven a los reinicios y no añaden infraestructura.
- **No:** memoria del proceso o Redis. La memoria se pierde en cada despliegue, y Redis llega cuando haya varias instancias (§5).
- **Sí:** ventana fija de 60 s. Es simple y suficiente como barrera. Una ventana deslizante no compensa su coste en SQL.
- **Sí:** fallar abierto si el contador no responde. Una caída del rate limiting no debe tumbar la atención al cliente.
- **No:** los E2E en CI. Lo decidió el equipo; llega en un spec de CI/CD.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Pruebas inestables por la latencia del tiempo real | Esperas con `expect.poll`/`toBeVisible({ timeout: 2000 })`, nunca `waitForTimeout`. Un reintento local con traza para diagnosticar. |
| WebKit en Linux o Docker difiere del Safari real de iOS | Los E2E cubren el layout y el flujo. La instalación en un iPhone real sigue siendo un criterio manual (SPEC 08). |
| Escritura en Postgres en cada petición | Una sola sentencia `UPSERT` por petición sobre una PK compuesta, con timeout de 500 ms y fallo abierto. Las métricas de SPEC 11 medirán su latencia. |
| `X-Forwarded-For` falsificado para esquivar el límite por IP | `TRUST_PROXY=2` solo confía en los dos saltos conocidos (Nginx y Caddy). El resto de la cadena se ignora. |
| `E2E_TESTING` activado por error en un servidor | `env.ts` rechaza el arranque con `NODE_ENV=production`, y las plantillas de `infra/deploy` no la incluyen. |

## Lo que **no** entra en este spec

- E2E en CI.
- Regresión visual y pruebas de carga.
- Límites por empresa o por plan.
- E2E de Google OAuth y de n8n real.
- Métricas (SPEC 11).

Cada uno llega en su propio spec.
