# SPEC 06 — Rediseño UI: sistema de diseño, bandeja, chat y panel de contacto

> **Status:** Approved
> **Depends on:** SPEC 05
> **Date:** 2026-10-12
> **Objective:** La PWA adopta un aspecto de herramienta de soporte profesional, con tokens de marca, tema claro/oscuro/sistema, rail de navegación, lista y chat rediseñados, panel de contacto plegable y búsqueda de conversaciones por nombre o teléfono en el servidor.

## Por qué existe este spec

La web de SPEC 01–05 es funcional, pero usa la paleta neutra por defecto de shadcn, un header horizontal y una lista y un chat mínimos. Antes de añadir login, ajustes y notificaciones (SPEC 07 en adelante), conviene fijar el sistema visual. Así esas pantallas nacen con el diseño definitivo y no hay que rehacerlas.

La dirección visual es la de una herramienta de soporte profesional (estilo Intercom/Front): navegación lateral, columnas de lista, chat y detalle, color de marca y densidad media. El cambio es casi solo de frontend. La única pieza de backend es la búsqueda (`q`) y el campo `createdAt` en el resumen de conversación.

## Alcance

**Dentro:**

- **Tokens de diseño** (`apps/web/src/index.css`):
  - Color de marca índigo como `--primary`, con variantes para claro y oscuro.
  - Tokens semánticos nuevos: `--sidebar`, `--sidebar-foreground`, `--bubble-customer`, `--bubble-ai`, `--bubble-agent` (y sus `-foreground`), `--info`.
  - El modo oscuro pasa de `prefers-color-scheme` a la clase `.dark` en `<html>` (la variante `dark` ya está declarada así).
- **Tema Claro / Oscuro / Sistema:**
  - Se guarda en `localStorage` con la clave `omnidesk:theme` (`light` | `dark` | `system`). Por defecto, `system`.
  - Un script inline en `index.html` aplica la clase antes del primer render, para evitar el parpadeo.
  - El `<meta name="theme-color">` se actualiza con el tema efectivo.
- **Tipografía:** Inter variable empaquetada con `@fontsource-variable/inter`. La precachea el service worker y funciona sin conexión.
- **Componentes base** en `apps/web/src/shared/ui/`, con estilo shadcn sobre primitivas Radix:
  - `avatar.tsx`: iniciales y color estable derivado del id.
  - `input.tsx`.
  - `tooltip.tsx`.
  - `dropdown-menu.tsx`: sustituye a `menu.tsx`.
  - `sheet.tsx`: hoja lateral sobre Radix Dialog.
  - `skeleton.tsx`.
  - `empty-state.tsx`.
  - `segmented-control.tsx`: para las bandejas.
- **Layout de la app** (`app-layout.tsx`):
  - **Escritorio (≥ md):** rail vertical de 64 px a la izquierda.
    - Arriba: logo, **Conversaciones** y **Estado** (iconos con tooltip).
    - Abajo: indicador de conexión (punto de color con tooltip "En vivo" / "Reconectando…"), menú de tema e instalar app.
    - El selector **Actuar como** se mantiene en el rail como menú de usuario provisional; SPEC 07 lo reemplaza.
  - **Móvil (< md):** el rail se convierte en una barra inferior con los mismos destinos. Se oculta mientras hay un chat abierto, para dejar sitio al composer.
- **Lista de conversaciones** (`conversation-list.tsx`):
  - Buscador arriba y, debajo, el control segmentado de bandejas (IA / Mías / Todas / Cerradas, según el rol).
  - Cada ítem muestra:
    - Avatar con iniciales.
    - Nombre, o el teléfono si no hay nombre.
    - Hora relativa ("14:05", "Ayer", "lun", "12/10").
    - Preview de una línea.
    - Chip de estado: **IA** (con icono de bot), nombre del agente asignado o **Cerrada**.
  - El ítem activo queda resaltado.
  - Mientras carga, se muestran skeletons.
  - Si no hay resultados, un estado vacío con el texto propio de cada bandeja, o "Sin resultados para «…»" si hay búsqueda.
- **Búsqueda en el servidor:**
  - Parámetro `q` en `GET /api/v1/conversations`. Busca por nombre del contacto o teléfono, dentro de la bandeja activa y con los permisos actuales.
  - En la web hay un debounce de 300 ms, y `q` se refleja en la URL (`/conversations?inbox=ai&q=juan`).
- **Chat** (`chat-view.tsx`, `message-bubble.tsx`, `system-line.tsx`, `message-composer.tsx`):
  - **Cabecera:** avatar, nombre, teléfono, chip de estado, acciones (`ConversationActions`) y un botón para abrir o cerrar el panel de contacto.
  - **Separadores por día:** "Hoy", "Ayer" o fecha larga ("lunes, 12 de octubre").
  - **Agrupación de burbujas:** los mensajes consecutivos del mismo emisor con menos de 5 min entre sí comparten un solo encabezado de autor y la cola visual.
  - **Estilos de burbuja:**
    - Cliente a la izquierda (`--bubble-customer`).
    - IA a la derecha con icono de bot (`--bubble-ai`).
    - Agente a la derecha en color de marca (`--bubble-agent`).
  - Los eventos del historial se muestran como píldoras centradas.
  - **Botón "Ir al final":** aparece si el usuario subió más de 200 px. Si llegan mensajes mientras está arriba, muestra "N mensajes nuevos".
  - **Composer** rediseñado: campo redondeado y botón de envío con icono. Conserva el comportamiento de SPEC 05.
- **Panel de contacto** (`features/conversations/ui/contact-panel.tsx`), de solo lectura:
  - Avatar y nombre.
  - Teléfono E.164 con botón **Copiar**.
  - Canal.
  - Estado, IA activa o agente asignado.
  - Fecha de inicio de la conversación.
  - Las mismas acciones de la cabecera.
  - **Visibilidad:**
    - En ≥ xl (1280 px) es una tercera columna de 320 px, visible por defecto. Su estado (abierto o cerrado) se guarda en `localStorage` con la clave `omnidesk:contact-panel`.
    - En < xl se abre como `Sheet` lateral derecho.
- **Página Estado** reestilizada con los nuevos `Card` y tokens, sin cambiar su lógica.
- **Contratos y API:**
  - `ListConversationsQuerySchema` añade `q`.
  - `ConversationSummarySchema` añade `createdAt`.

**Fuera de alcance (para specs futuros):**

- Contador de no leídos (requiere el modelo `lastReadSequence` por miembro).
- Búsqueda en el texto de los mensajes (requiere `pg_trgm` o full-text).
- Edición de datos del contacto y notas.
- Pantallas de login, onboarding y ajustes (SPEC 07).
- Pruebas visuales automatizadas con Playwright (SPEC 10).
- Animaciones de entrada de mensajes más allá de las de `tw-animate-css`.

## Modelo de datos

No hay cambios en Prisma.

**Contratos** (`packages/contracts/src/conversations.ts`):

```ts
ListConversationsQuerySchema = {
  inbox, cursor, limit,                                   // sin cambios
  /** Nombre del contacto o teléfono; se recorta. Vacío = sin filtro. */
  q: z.string().trim().min(2).max(100).optional(),
}

ConversationSummarySchema += {
  createdAt: z.iso.datetime(),                            // inicio de la conversación
}
```

**Regla de búsqueda** (`modules/conversations/application/inbox-filter.ts`):

- `contacts.display_name ILIKE '%' || q || '%'`, o bien
- si `q` contiene 3 dígitos o más tras quitar espacios, `+`, `-` y paréntesis: `contact_identities.external_id LIKE '%' || <dígitos> || '%'`.
- Se combina con `AND` con el filtro de la bandeja y los permisos de SPEC 04. El cursor de paginación sigue siendo el mismo.

**Estado de la web** (`localStorage`, todas las lecturas y escrituras en `try/catch`):

```ts
'omnidesk:theme'          // 'light' | 'dark' | 'system'
'omnidesk:contact-panel'  // 'open' | 'closed'
```

**Funciones puras nuevas** (`features/conversations/model/` y `shared/lib/`), todas con pruebas Vitest:

```ts
groupTimelineByDay(items, now): Array<{ dayLabel: string; items: TimelineItem[] }>
groupConsecutiveBubbles(items): Array<{ showAuthor: boolean; isLastOfGroup: boolean; item }>
initials(displayName: string | null, fallback: string): string      // "Juan Pérez" → "JP"; null → "+57…" → "#"
avatarColor(id: string): AvatarColor                                 // determinista, 8 colores
formatListTime(iso: string, now: Date): string                       // "14:05" | "Ayer" | "lun" | "12/10"
resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark'
normalizeSearch(raw: string): string | undefined                     // trim; < 2 chars → undefined
```

## Plan de implementación

1. **Contratos y API de búsqueda.**
   - Añadir `q` y `createdAt` a los esquemas, con pruebas.
   - Implementar el filtro en `inbox-filter.ts` y `prisma-conversation-read-model.ts`.
   - e2e: buscar por nombre parcial, por teléfono con espacios y por un término sin resultados. Comprobar que `q` respeta la bandeja y que Mateo no encuentra conversaciones de Laura.
2. **Dependencias y tokens.**
   - Instalar `@radix-ui/react-avatar`, `@radix-ui/react-tooltip`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog` y `@fontsource-variable/inter`, con versión exacta como el resto.
   - Reescribir `index.css` con la paleta índigo y los tokens nuevos, y el modo oscuro por la clase `.dark`.
   - La app sigue funcionando con los componentes actuales.
3. **Tema.**
   - `shared/theme/theme-store.ts` (`resolveTheme` + persistencia) y `theme-menu.tsx`.
   - Script inline en `index.html` y actualización de `theme-color`.
   - Pruebas de `resolveTheme`.
4. **Componentes base.**
   - `avatar`, `input`, `tooltip`, `dropdown-menu`, `sheet`, `skeleton`, `empty-state` y `segmented-control`.
   - Migrar los usos de `menu.tsx` a `dropdown-menu.tsx` y borrar `menu.tsx`.
   - Pruebas de `initials` y `avatarColor`.
5. **Layout.**
   - `app/app-layout.tsx` con el rail de escritorio y la barra inferior móvil (`app/nav-rail.tsx`, `app/bottom-nav.tsx`).
   - `ConnectionBadge` pasa a ser un punto con tooltip.
   - La barra inferior se oculta en `/conversations/:id`.
6. **Lista.**
   - Rediseñar el ítem con avatar, nombre, hora, preview y chip.
   - Skeletons y estados vacíos.
   - `inbox-tabs.tsx` pasa a usar `SegmentedControl`.
   - Buscador con debounce y `q` en la URL.
   - Pruebas de `formatListTime` y `normalizeSearch`.
7. **Chat.**
   - Cabecera nueva.
   - `groupTimelineByDay` y `groupConsecutiveBubbles`, con pruebas, aplicadas en `chat-view.tsx`.
   - Estilos de burbuja por emisor y píldoras de eventos.
   - Botón "Ir al final" con contador de nuevos.
   - Composer reestilizado sin cambios de comportamiento: siguen pasando las pruebas de `composer-mode`.
8. **Panel de contacto.**
   - `contact-panel.tsx` con los datos de `useConversation(id)` (`GET /conversations/:id`).
   - Columna en ≥ xl con persistencia, y `Sheet` en < xl.
   - Botón **Copiar** con `navigator.clipboard` y el tooltip "Copiado".
9. **Página Estado y 404** con los tokens y componentes nuevos.
10. **Documentación.**
    - README: capturas o descripción del nuevo layout, el tema y la búsqueda.
    - `docs/arquitectura.md` §10: rail + lista + chat + panel.

## Criterios de aceptación

**Búsqueda (API)**

- [ ] `GET /conversations?inbox=all&q=jua` como Sup. Demo devuelve solo las conversaciones cuyo contacto contiene "jua" en el nombre, sin distinguir mayúsculas.
- [ ] `q=300 123` encuentra el contacto con teléfono `+573001234567`.
- [ ] `q=a` (1 carácter) responde `400`.
- [ ] Como Mateo, `q` nunca devuelve conversaciones asignadas a Laura.
- [ ] `ConversationSummary.createdAt` aparece en la lista y en `GET /conversations/:id`.

**Tema y tokens**

- [ ] Con el tema **Oscuro** elegido en el menú, recargar la página la abre en oscuro sin parpadeo en claro.
- [ ] Con **Sistema**, cambiar la preferencia del sistema operativo cambia el tema sin recargar.
- [ ] Con `localStorage` bloqueado (ventana privada de Safari), la app carga con el tema del sistema y no muestra errores en la consola.
- [ ] La fuente Inter se carga sin peticiones a dominios externos (pestaña Network).

**Layout** (comprobado en 375, 768, 1280 y 1536 px, en claro y oscuro)

- [ ] En ≥ 768 px se ve el rail izquierdo con Conversaciones y Estado. Cada icono muestra su tooltip al pasar el ratón.
- [ ] En 375 px se ve la barra inferior en la lista y desaparece al abrir un chat.
- [ ] Ningún ancho muestra scroll horizontal en la página.
- [ ] El punto de conexión es verde con "En vivo" y ámbar con "Reconectando…" al detener el API.

**Lista y chat**

- [ ] Cada ítem muestra avatar con iniciales, nombre o teléfono, hora relativa, preview y un chip IA, nombre del agente o Cerrada.
- [ ] Escribir "jua" en el buscador actualiza la URL con `q=jua` y filtra la lista en ≤ 1 s. Borrarlo restaura la lista.
- [ ] Una bandeja sin conversaciones muestra su estado vacío, nunca una lista en blanco.
- [ ] El historial muestra los separadores "Hoy" y "Ayer" cuando hay mensajes de esos días.
- [ ] Tres mensajes seguidos del cliente en menos de 5 min muestran un solo encabezado de autor.
- [ ] Con el usuario arriba en el historial, un mensaje nuevo del simulador muestra "1 mensaje nuevo". Al pulsarlo, baja al final.
- [ ] Siguen cumpliéndose todos los criterios de la sección "Web" de SPEC 05: composer, ticks y reintento.

**Panel de contacto**

- [ ] En 1536 px el panel se ve a la derecha. Cerrarlo y recargar lo mantiene cerrado.
- [ ] En 1024 px el botón del panel abre una hoja lateral que se cierra con Esc o tocando fuera.
- [ ] **Copiar** copia el teléfono E.164 al portapapeles y muestra "Copiado".
- [ ] Asignar desde el panel actualiza el chip en la cabecera, en la lista y en el panel sin recargar.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.
- [ ] El build de producción instala y abre la PWA como antes (`WEB_UPSTREAM=web-preview:4173`).

## Decisiones

- **Sí:** estilo de herramienta de soporte profesional (Intercom/Front). Lo decidió el equipo; encaja con supervisores que trabajan muchas horas en escritorio.
- **No:** imitar WhatsApp Web. Confunde al agente sobre en qué herramienta está, y la IA y los eventos necesitan su propio lenguaje visual.
- **Sí:** rail + lista + chat + panel plegable. Deja más ancho al chat que un sidebar con bandejas. Las bandejas van como control segmentado sobre la lista. Lo decidió el equipo.
- **Sí:** tema Claro/Oscuro/Sistema persistido en `localStorage`. Es una comodidad por dispositivo; no hace falta sincronizarlo. Lo decidió el equipo.
- **Sí:** Radix + Inter vía `@fontsource`. Accesibilidad resuelta (foco, teclado, ARIA) y fuente disponible sin conexión en la PWA. Lo decidió el equipo.
- **Sí:** búsqueda en el servidor por nombre y teléfono, dentro de la bandeja activa. Un filtro local solo vería la página cargada. Lo decidió el equipo.
- **No:** índices nuevos para la búsqueda. El filtro va acotado por `tenant_id` y bandeja, y los volúmenes del MVP son pequeños. Si hace falta, se añade `pg_trgm` junto con la búsqueda en mensajes.
- **No:** no leídos en este spec. Requieren un modelo por miembro que llega con la identidad real. Lo decidió el equipo.
- **Sí:** panel de contacto de solo lectura con datos existentes. Solo añade `createdAt`; editar el contacto es otra funcionalidad. Lo decidió el equipo.
- **Sí:** barra inferior en móvil que se oculta en el chat. El composer necesita todo el alto con el teclado abierto (riesgo ya mitigado en SPEC 05).
- **Sí:** verificación por checklist manual en 4 anchos + Vitest para la lógica pura. Playwright llega en SPEC 10. Lo decidió el equipo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Parpadeo del tema claro al cargar en oscuro | Script inline síncrono en `<head>` que aplica `.dark` antes de que React monte. |
| `ILIKE '%q%'` lento con muchos contactos | Acotado por tenant y bandeja, con `limit` ≤ 100. El índice `pg_trgm` queda anotado como evolución. |
| Regresiones en composer, ticks y acciones al rehacer los componentes | Se reutiliza la lógica (`composer-mode`, `to-bubble-view`, `use-conversation-command`) sin tocarla, con sus pruebas, y el checklist de SPEC 05 se repite. |
| La caché del service worker sirve la fuente o el CSS viejos | Los assets llevan hash de Vite y `cleanupOutdatedCaches` ya está activo. "Nueva versión disponible" sigue funcionando. |
| Contraste insuficiente de los tokens en oscuro | Cada pareja `--x` / `--x-foreground` se revisa con ratio ≥ 4.5:1 antes de cerrar el paso 2. |

## Lo que **no** entra en este spec

- No leídos.
- Búsqueda en el texto de los mensajes.
- Edición del contacto y notas.
- Login, onboarding y ajustes (SPEC 07).
- Playwright y pruebas visuales (SPEC 10).

Cada uno llega en su propio spec.
