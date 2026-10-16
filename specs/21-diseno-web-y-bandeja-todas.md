# SPEC 21 — Diseño web en ajustes, plataforma y login; icono con aviso; Agent ve Todas

> **Status:** Approved
> **Depends on:** SPEC 04, SPEC 06, SPEC 16, SPEC 17, SPEC 18, SPEC 20
> **Date:** 2026-10-15
> **Objective:** Empresa, Notificaciones y Perfil pasan a ajustes en dos columnas, `/platform` a una tabla con columnas, login, onboarding e invitación a pantalla partida, el icono de Conversaciones solo se anima cuando entra un mensaje de un cliente, y un Agent ve las pestañas "Todas" y "Cerradas" completas en solo lectura.

## Por qué existe este spec

Sale de la petición del 2026-10-15. Son cinco piezas que comparten objetivo: que la app se vea y se use como una aplicación web terminada en escritorio.

- **Ajustes.** Miembros y Canales (SPEC 17) ya tienen cabecera de página y ancho de escritorio. Empresa, Notificaciones y Perfil siguen siendo tarjetas apiladas de `max-w-2xl`, sin cabecera, pensadas para móvil.
- **Plataforma.** Ya tiene cabecera y pestañas (SPEC 18 y 20), pero cada fila es un bloque de texto apilado con todos los botones a la derecha. Con varias empresas no se puede comparar nada de un vistazo.
- **Login.** Es una tarjeta centrada (`AuthCard`) que en un monitor deja la pantalla vacía.
- **Icono de Conversaciones.** Desde SPEC 17 se anima siempre. Como animación decorativa ya no aporta: el usuario quiere que la animación signifique "hay un mensaje nuevo".
- **Agent y "Todas".** El usuario quiere que un Agent vea la pestaña "Todas". Es un cambio de permisos, no de diseño. Se planteó llevarlo a su propio spec y el usuario decidió incluirlo aquí.

Lo que ya fijaron otros specs y aquí no se reabre:

- Tokens, tema, `SegmentedControl`, `Card`, `EmptyState` y `DropdownMenu` (SPEC 06).
- Bocadillos del icono, `.chat-in`, `.chat-out` y `--nav-icon-bg` (SPEC 17).
- Acciones de plataforma, sus diálogos y sus códigos de error (SPEC 18 y 20).
- Tomar, soltar, cerrar, reabrir, reasignar y escribir: quién puede hacerlo no cambia (SPEC 04 y 05).

## Alcance

**Dentro:**

- **Piezas compartidas** en `apps/web/src/shared/ui/`:
  - `page-header.tsx`: `PageHeader` con título (`text-2xl`), subtítulo y una zona de acciones a la derecha. Es la cabecera que hoy repiten Miembros, Canales y Plataforma.
  - `settings-section.tsx`: `SettingsSection` con `title`, `description`, `children` y `tone?: 'danger'`.
    - En ≥ md es una fila de rejilla de dos columnas, 1/3 y 2/3. A la izquierda van el título y la descripción. A la derecha va una `Card` con el contenido.
    - Las secciones se separan con una línea (`border-t`).
    - En < md se apila: título y descripción arriba, la tarjeta debajo.
    - `tone="danger"` pinta el título en `text-destructive` y el borde de la tarjeta en `border-destructive/40`.
  - Miembros, Canales y Plataforma pasan a usar `PageHeader`, sin cambio visible.
- **Ajustes en dos columnas.** Ancho `max-w-5xl`, con el mismo relleno que Miembros (`px-4 py-6 md:px-8 md:py-10`).
  - **`/settings/company`** (Owner):
    - Cabecera "Empresa", subtítulo "Datos, logo, retención y estado de la empresa".
    - Secciones, con los títulos y descripciones de hoy:
      1. **Empresa:** nombre e identificador.
      2. **Contacto.**
      3. **Logo.**
      4. **Retención de datos** (`RetentionCard` deja de ser tarjeta suelta y pasa a sección).
      5. **Zona de peligro** (`tone="danger"`).
    - Con la empresa inactiva: la misma cabecera y una sola sección "Empresa inactiva", con el texto y el botón "Reactivar" de hoy.
    - Cargando: cabecera y dos secciones con skeleton. Sin acceso: el `EmptyState` de hoy.
  - **`/settings/notifications`:**
    - Cabecera "Notificaciones", subtítulo "Avisos push de OmniDesk".
    - Secciones:
      1. **Este dispositivo:** estado, activar o desactivar y "Enviar prueba", con la lógica de hoy.
      2. **Qué avisarte:** las preferencias, con la descripción "Estas preferencias son de esta empresa."
  - **`/settings/profile`:**
    - Cabecera "Mi perfil", subtítulo "Tu cuenta en OmniDesk".
    - Secciones:
      1. **Foto:** "Tu foto se ve en todas tus empresas.", con subir, cambiar y quitar como hoy.
      2. **Cuenta:** nombre y email, solo lectura, con la descripción "Vienen de tu cuenta de Google."
  - Avisos de éxito o error: cada uno va dentro de la sección que lo produjo.
- **`/platform` en tabla.** Ancho `max-w-6xl`.
  - En ≥ md, las filas son una rejilla de columnas fijas, igual en todas las filas, con una fila de encabezados encima.
  - **Pendientes, Aprobadas y Rechazadas.** Columnas:
    1. **Empresa:** nombre y, debajo en gris, el slug.
    2. **Owner** (en Aprobadas) o **Solicitante:** nombre y, debajo, el email.
    3. **Contacto:** teléfono y, debajo, el email de contacto ("Sin teléfono" y "Sin email de contacto" si faltan).
    4. **Fecha:** pedida, aprobada o rechazada, según la pestaña.
    5. **Estado:** la insignia de hoy (Activa, Inactiva, Suspendida). Solo en Aprobadas; en las otras pestañas la columna no aparece.
    6. **Acciones.**
  - El motivo del rechazo o de la suspensión va en una línea bajo la fila, a todo el ancho, con el estilo de hoy.
  - **Borradas.** Columnas: Empresa (nombre y slug), Borrada por (email), Pedida el, Estado ("Borrando…" o "Borrada el D") y Conteos. Sin acciones.
  - **Acciones**: la principal como botón y el resto en un menú "⋯":

    | Fila | Botón | Menú "⋯" |
    | --- | --- | --- |
    | Pendiente | Aprobar | Rechazar |
    | Aprobada activa o inactiva | — | Suspender |
    | Aprobada suspendida | Levantar suspensión | Borrar |
    | Rechazada | — | — |

    Las opciones destructivas del menú (Rechazar, Suspender, Borrar) van en `text-destructive`. Abren los diálogos de hoy. Sin acciones, la columna queda vacía con el mismo ancho.

  - **Móvil (< md):** la fila se apila como hoy y las acciones van debajo (botón y "⋯").
  - Se conservan las pestañas, `?tab=`, los estados de carga, error y vacío, el refresco de "Borrando…" y la barra superior propia.
- **Login, onboarding e invitación en pantalla partida.** Cambia `AuthCard`, que usan las tres.
  - **En ≥ lg**, dos columnas a pantalla completa:
    - **Izquierda:** panel de marca sobre `bg-primary` con `text-primary-foreground`:
      - logo y "OmniDesk";
      - el titular "Supervisa la IA y a tu equipo en una sola bandeja.";
      - tres ventajas con icono de check:
        - "Todas las conversaciones de WhatsApp en un lugar".
        - "La IA responde y tu equipo toma el control cuando hace falta".
        - "En tiempo real, también desde el móvil".
    - **Derecha:** el contenido actual (título, descripción, hijos) centrado, con `max-w-sm` y sin borde de tarjeta. El menú de tema sigue arriba a la derecha.
  - **En < lg:** la tarjeta centrada de hoy, sin panel de marca.
  - En la invitación, la marca de la empresa (`mark`) sigue sobre el título, en la columna derecha. El panel izquierdo siempre es de OmniDesk.
- **Icono de Conversaciones con aviso.**
  - **Reposo:** quieto, con los dos bocadillos visibles (el estado final de hoy con movimiento reducido).
  - **Disparo:** un evento `conversation.changed` con `reason: 'message'` e `inbound: true`. Cuenta cualquier conversación de la empresa, para todos los roles.
  - **Fuera de `/conversations`:** el icono anima en bucle (el de SPEC 17, 2,4 s) hasta que el usuario entra a una ruta bajo `/conversations`. Al entrar, vuelve a reposo.
  - **Dentro de `/conversations`:** cada mensaje nuevo hace una sola pasada de 2,4 s. Si llega otro durante la pasada, la pasada vuelve a empezar.
  - **Con `prefers-reduced-motion: reduce`:** no anima. Fuera de `/conversations` muestra un punto fijo de `bg-primary` en la esquina superior derecha del icono, hasta entrar. Dentro no muestra nada.
  - Mientras hay aviso, el `aria-label` del enlace es "Conversaciones, mensajes nuevos".
  - Aplica igual en el rail y en la barra inferior móvil.
  - El aviso vive en memoria, por pestaña del navegador. Recargar lo borra. La resincronización al reconectar el socket no lo enciende.
- **Evento de mensaje del cliente (contrato y API):**
  - `RealtimeEventSchema` gana `inbound: z.literal(true).optional()`.
  - `enqueueConversationChanged` acepta `{ inbound: true }`. Solo `RegisterInboundMessageUseCase` lo pasa.
  - Las respuestas de la IA y la descarga de adjuntos siguen emitiendo `message` sin `inbound`.
- **Agent ve "Todas" y "Cerradas" completas, en solo lectura:**
  - **Bandejas:** un Agent ve las cuatro pestañas (Sin asignar, Mías, Todas, Cerradas).
    - "Todas" son todas las abiertas de la empresa.
    - "Cerradas" son todas las cerradas de la empresa, no solo las que llevaba él.
  - **Contadores:** `GET /conversations/counts` devuelve `all` a todos los roles.
  - **Ver:** `can(actor, 'view', …)` es `true` para un Agent en cualquier conversación de la empresa. Abre el chat, el historial, los adjuntos y el panel de contacto de una conversación de otro agente.
  - **Actuar:** sin cambios.
    - En una conversación de otro agente, un Agent no puede tomar, soltar, cerrar, reasignar, reabrir ni escribir.
    - Bajo el chat ve el aviso "Asignada a X" de hoy (`composerMode` → `assigned-other`).
    - En una cerrada que no llevaba él, no ve "Reabrir".
  - **Descripción del rol** en el menú de rol de Miembros (SPEC 17): Agent pasa a "Ve todas y atiende las suyas".
  - Los avisos push no cambian: un Agent sigue recibiendo solo los de SPEC 13.

**Fuera:**

- Un submenú lateral de Ajustes que agrupe Empresa, Miembros, Canales, Notificaciones y Perfil.
- Rediseñar Miembros, Canales, Estado, la bandeja o el chat (más allá de usar `PageHeader`).
- Integrar `/platform` en el rail de la app.
- Ordenar, filtrar, buscar o paginar la tabla de `/platform`.
- Editar el nombre o el email desde Mi perfil.
- Un contador de no leídos, o un aviso que sobreviva a recargar la página.
- Que la animación cuente "pendientes por asignar" (conversaciones sin agente).
- Que un Agent actúe en conversaciones de otros (tomarlas, escribir, reabrir).
- Avisos push nuevos para el Agent por las conversaciones que ahora ve.
- Ilustraciones o imágenes en el panel de marca del login.

## Modelo de datos

**No hay migración ni datos persistentes nuevos.**

**Contrato (`packages/contracts/src/realtime.ts`):**

```ts
export const RealtimeEventSchema = z.object({
  type: z.literal('conversation.changed'),
  conversationId: z.uuid(),
  reason: z.enum(['message', 'assignment', 'delivery', 'deleted']),
  /** SPEC 21: el mensaje lo envió el cliente. Solo con `reason: 'message'`. */
  inbound: z.literal(true).optional(),
  occurredAt: z.iso.datetime(),
});
```

**Contrato (`packages/contracts/src/conversations.ts`):**

```ts
export const InboxCountsResponseSchema = z.object({
  ai: z.int().min(0),
  mine: z.int().min(0),
  all: z.int().min(0), // SPEC 21: deja de ser opcional
});
```

**Política (`packages/contracts/src/conversation-policy.ts` y su copia en `apps/api/src/modules/conversations/domain/conversation-policy.ts`):**

- `can(actor, 'view', …)` devuelve `true` para cualquier rol.
- `canViewInbox` desaparece, porque todas las bandejas son visibles para todos los roles. Con él desaparece `InboxForbiddenError` en `inbox-filter.ts`.
- `inboxFilter`, bandeja `closed`: `{ status: 'CLOSED' }` para todos los roles.
- `assign`, `release`, `close` y `reopen` no cambian.

**Web, en memoria (`apps/web/src/features/conversations/model/new-message-signal.ts`):**

```ts
type NewMessageSignal =
  | { kind: 'idle' }
  | { kind: 'pending' } // fuera de /conversations: bucle o punto hasta entrar
  | { kind: 'pulse'; seq: number }; // dentro: una pasada; `seq` reinicia la animación
```

- Funciones `signalInbound(onConversations: boolean)` y `clearSignal()`, y el hook `useNewMessageSignal()` sobre `useSyncExternalStore`, como `contact-panel-store.ts`.
- `ChatReplyIcon` gana `mode: 'idle' | 'loop' | 'once'`. El CSS solo anima `.chat-in` y `.chat-out` dentro de `[data-mode='loop']` (infinito) o `[data-mode='once']` (una iteración).

## Plan de implementación

1. **Permisos del Agent en el API y el contrato.**
   - `can('view')` para todos, sin `canViewInbox` ni `InboxForbiddenError`, `closed` sin filtro por agente, y `all` obligatorio en los contadores.
   - Pruebas unitarias de la política, de `inbox-filter` y de `count-inboxes`.
   - En `assignment.e2e-spec.ts`, la prueba de `inbox: 'all'` pasa de `403` a `200`. Se añade un caso: un Agent lee el timeline de una conversación de otro agente (`200`), pero escribir y cerrar en ella dan `403`.
2. **Permisos del Agent en la web.**
   - `visibleInboxes` devuelve las cuatro bandejas para todos los roles.
   - La descripción del rol Agent en `role-menu.tsx`.
   - Pruebas de `inbox.ts` y de `composer-mode.ts` (un Agent en una conversación de otro ve `assigned-other`).
3. **Evento `inbound`.**
   - Campo en `RealtimeEventSchema` con su prueba de contrato.
   - Opción en `enqueueConversationChanged`, y `RegisterInboundMessageUseCase` la pasa.
   - Prueba unitaria: el payload encolado lleva `inbound: true` en un entrante y no lo lleva en la respuesta de la IA.
4. **Señal de mensaje nuevo.**
   - `new-message-signal.ts` con pruebas unitarias: pasa a `pending` fuera, a `pulse` dentro (y `seq` sube), y `clearSignal` vuelve a `idle`.
   - `RealtimeProvider` llama a `signalInbound` con `event.inbound`.
   - `AppLayout` llama a `clearSignal` al entrar a `/conversations`.
5. **Icono.**
   - `ChatReplyIcon` con `mode`, y el CSS de `index.css` con `[data-mode]` y su bloque de `prefers-reduced-motion`.
   - El punto fijo y el `aria-label` en `nav-rail.tsx` y `bottom-nav.tsx`.
6. **Piezas compartidas.** `PageHeader` y `SettingsSection`. Miembros, Canales y Plataforma pasan a `PageHeader`.
7. **Empresa en dos columnas.** `company-page.tsx` y `retention-card.tsx` (a `retention-section.tsx`), con los estados activa, inactiva, cargando y sin acceso.
8. **Notificaciones y Perfil en dos columnas.** `notifications-page.tsx` y `profile-page.tsx`.
9. **Plataforma en tabla.**
   - Separar `platform-page.tsx` en:
     - `platform-page.tsx`: cabecera, pestañas y estados.
     - `platform-table.tsx`: encabezados y rejilla.
     - `platform-row.tsx`: fila de empresa.
     - `deletion-row.tsx`: fila de borrada.
     - `platform-row-actions.tsx`: botón principal y menú "⋯".
   - Vista apilada en móvil.
10. **Pantalla partida.** `AuthCard` con el panel de marca en ≥ lg. Comprobar login, onboarding (todas sus pantallas) e invitación.
11. **Documentación.**
    - En `docs/arquitectura.md`, el permiso de ver del Agent.
    - Sección "Verificación de implementación" en este spec.

## Criterios de aceptación

**Ajustes:**

- [ ] En `/settings/company`, `/settings/notifications` y `/settings/profile` hay una cabecera con título y subtítulo.
- [ ] A 1280 px cada sección muestra el título y la descripción a la izquierda y la tarjeta a la derecha.
- [ ] A 400 px las secciones se apilan y no hay scroll horizontal.
- [ ] Empresa muestra cinco secciones: Empresa, Contacto, Logo, Retención de datos y Zona de peligro. Zona de peligro va en rojo.
- [ ] Guardar datos, cambiar el logo, cambiar la retención e inactivar funcionan como antes, y su aviso aparece dentro de su sección.
- [ ] Con la empresa inactiva, Empresa muestra la cabecera y la sección "Empresa inactiva" con "Reactivar".
- [ ] Mi perfil muestra las secciones Foto y Cuenta. Cuenta tiene el nombre y el email, sin campos editables.
- [ ] Notificaciones muestra las secciones Este dispositivo y Qué avisarte. Activar, desactivar y enviar la prueba funcionan como antes.

**Plataforma:**

- [ ] A 1280 px, `/platform` muestra una fila de encabezados, y las columnas quedan alineadas en todas las filas, con nombres de distinta longitud.
- [ ] Una pendiente muestra el botón "Aprobar" y "Rechazar" en el menú "⋯".
- [ ] Una aprobada activa no tiene botón y tiene "Suspender" en el menú "⋯".
- [ ] Una aprobada suspendida muestra "Levantar suspensión" y tiene "Borrar" en el menú "⋯".
- [ ] Cada acción abre el diálogo de hoy y funciona como antes.
- [ ] La pestaña Borradas muestra sus cinco columnas, sin acciones.
- [ ] A 400 px las filas se apilan y no hay scroll horizontal.

**Login:**

- [ ] A 1280 px, `/login` muestra el panel de marca índigo a la izquierda (logo, titular y tres ventajas) y el login a la derecha.
- [ ] A 400 px muestra solo la tarjeta de hoy.
- [ ] `/onboarding` e `/invite/:token` usan la misma pantalla partida. La invitación muestra la marca de la empresa sobre el título.

**Icono:**

- [ ] Sin mensajes nuevos, el icono de Conversaciones está quieto con los dos bocadillos visibles.
- [ ] Estando en `/status` o en Ajustes, un mensaje de un cliente (`simulate` o webhook) pone el icono a animar en bucle en el rail y en la barra móvil. Entrar a Conversaciones lo detiene.
- [ ] Estando en `/conversations`, un mensaje de un cliente hace una sola pasada.
- [ ] Una respuesta de la IA o un mensaje enviado por un agente no animan el icono.
- [ ] Con "reducir movimiento", un mensaje de un cliente fuera de Conversaciones muestra el punto fijo, y entrar lo quita.
- [ ] Con aviso, el enlace se anuncia como "Conversaciones, mensajes nuevos".
- [ ] El evento de un entrante lleva `inbound: true`. El de una respuesta de la IA no lo lleva.

**Agent:**

- [ ] Un Agent ve las pestañas Sin asignar, Mías, Todas y Cerradas, y "Todas" muestra su contador.
- [ ] `GET /api/v1/conversations?inbox=all` como Agent responde `200` con todas las abiertas de la empresa.
- [ ] Como Agent, "Cerradas" incluye conversaciones que cerró otro agente.
- [ ] Un Agent abre una conversación de otro agente y ve el historial, los adjuntos y el panel de contacto.
- [ ] En esa conversación, el Agent ve "Asignada a X" y no tiene composer, ni "Tomar", "Soltar", "Cerrar" o "Reabrir".
- [ ] Enviar un mensaje o cerrar esa conversación por API como Agent responde `403`.
- [ ] El menú de rol describe Agent como "Ve todas y atiende las suyas".

**General:**

- [ ] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: ajustes en dos columnas** (elegido por el usuario). Se descartaron solo añadir cabecera en una columna y una página de Ajustes con submenú lateral.
- **Sí: `SettingsSection` y `PageHeader` compartidos.** Cinco páginas repiten la misma estructura, y un componente evita que vuelvan a divergir.
- **Sí: `/platform` en tabla con columnas** (elegido por el usuario). Se descartó meterlo en el rail de la app: Plataforma vive fuera de una empresa (SPEC 18).
- **Sí: acción principal visible y el resto en "⋯"** (elegido por el usuario), frente a todo en "⋯" o todos los botones visibles.
- **Sí: pantalla partida en login, onboarding e invitación** (elegido por el usuario). Las tres comparten `AuthCard`, y separarlas dejaría dos estilos de entrada.
- **No: imágenes o ilustraciones en el panel de marca.** Peso extra en la PWA para una pantalla que se ve poco. El color de marca y el texto bastan.
- **Sí: el icono solo se anima con mensajes de cliente** (elegido por el usuario). Revierte la decisión de SPEC 17 de animarlo siempre.
- **No: animar por "pendientes por asignar"** (elegido por el usuario). Con la IA atendiendo, casi siempre habría alguna sin agente y el icono no dejaría de moverse.
- **Sí: campo `inbound` en el evento** (elegido por el usuario), frente a animar con cualquier `message`. El evento `message` también sale con las respuestas de la IA y al terminar una descarga, y animaría de más.
- **Sí: bucle hasta entrar a Conversaciones y una pasada si ya está ahí** (elegido por el usuario), frente a una ráfaga fija de 7,2 s que se pierde si no se mira.
- **Sí: punto fijo con movimiento reducido** (elegido por el usuario). Sin él, quien desactiva animaciones pierde el aviso.
- **Sí: aviso en memoria, por pestaña.** Sobrevivir a recargar exige guardar qué se vio, y eso es un contador de no leídos, que queda fuera.
- **Sí: un Agent ve "Todas" y todas las "Cerradas"** (petición del usuario, incluido aquí por decisión suya). Revierte la regla de SPEC 04 "un AGENT solo lo suyo y lo que está sin asignar" para ver, no para actuar.
- **Sí: solo lectura en conversaciones ajenas** (elegido por el usuario). Se descartaron que el Agent pueda tomarlas o que tenga los mismos permisos que un Admin.
- **Sí: el icono cuenta todas las conversaciones, para todos los roles** (elegido por el usuario). Con el Agent viendo todas, filtrar no tiene sentido, y el evento no necesita `assignedMemberId`.
- **No: spec propio para el permiso del Agent.** Se propuso y el usuario prefirió incluirlo. El spec toca cinco áreas, pero las cuatro de diseño son de frontend y no dependen entre sí.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Un Agent ahora lee chats y datos de contacto de clientes que no atiende. Es un cambio de privacidad respecto a SPEC 04. | Es la decisión del usuario, anotada arriba. Solo dentro de su empresa, y sin poder actuar. Las e2e comprueban el `403` al escribir o cerrar. |
| Quitar `canViewInbox` deja algún llamador sin actualizar (API o web). | El typecheck falla en cualquier uso que quede. La e2e de `inbox: 'all'` como Agent lo cubre en el API. |
| La política está duplicada en el contrato y en el dominio del API, y una copia queda distinta. | El paso 1 cambia las dos, con las mismas pruebas unitarias. |
| Con varias pestañas abiertas, el aviso se apaga en una y sigue en otra. | Aceptado: el aviso es por pestaña. Se apaga al entrar a Conversaciones en cada una. |
| El socket se reconecta y se pierde un entrante mientras estaba caído. | No se enciende el aviso. La resincronización actualiza la lista y el push (SPEC 13) sigue avisando. |
| Reiniciar la pasada con cada mensaje deja el icono a medias si llegan muchos seguidos. | `seq` remonta el SVG y la pasada empieza de cero. Con mensajes cada < 2,4 s se ve como un bucle, que es correcto. |
| El panel de marca empuja el contenido del onboarding, que tiene formularios largos. | La columna derecha tiene su propio scroll. Los criterios revisan las pantallas del onboarding a 1280 px. |
| La tabla de `/platform` se queda estrecha entre md y lg con seis columnas. | `max-w-6xl`, y Contacto y Fecha truncan con `title` completo. Se revisa a 800 px. |

## Qué **no** entra en este spec

- Submenú de Ajustes, o rediseñar Miembros, Canales, Estado, la bandeja o el chat.
- Plataforma dentro del rail, o con orden, filtros, búsqueda o paginación.
- Editar nombre o email en Mi perfil.
- Contador de no leídos, aviso persistente o animación por "pendientes por asignar".
- Que un Agent actúe en conversaciones ajenas, o avisos push nuevos para él.
- Ilustraciones en el login.

Cada uno de esos, si llega, va en su propio spec.
