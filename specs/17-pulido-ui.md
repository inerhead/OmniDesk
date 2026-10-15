# SPEC 17 — Pulido de UI: icono de Conversaciones, Miembros y Canales

> **Status:** Approved
> **Depends on:** SPEC 06, SPEC 07, SPEC 09, SPEC 15
> **Date:** 2026-10-14
> **Objective:** El icono de Conversaciones se anima con dos bocadillos que se responden, `/settings/members` pasa a pestañas con filas alineadas (nombre, email, rol y acciones), y `/settings/channels` pasa a una lista con estado y un panel lateral por canal con pasos numerados.

## Por qué existe este spec

Es el tercero de los que salieron de la petición del 2026-10-14 (tras SPEC 15 y SPEC 16). Son tres arreglos visuales independientes que comparten objetivo: que la app se vea terminada.

- **Icono de Conversaciones.** Hoy es el `MessageSquare` estático de lucide. Estado ya tiene un icono propio animado (`StatusPulseIcon`, electrocardiograma) y el avatar tiene el punto de conexión que late. Conversaciones desentona.
- **Miembros.** Las filas no se alinean entre sí: avatar, nombre, `<select>` nativo de rol y "Quitar" ocupan anchos distintos en cada fila. Las invitaciones van en una segunda tarjeta debajo, y no se ve el email de nadie.
- **Canales.** Cada canal es un acordeón que, al abrirse, mezcla sin orden la URL del webhook de Meta, el formulario de secretos, el interruptor de IA, las credenciales de n8n y la prueba de conexión. No hay estado visible en la lista: no se sabe qué canal está a medio configurar.

Las propuestas del icono se compararon en una página con las cuatro animadas (https://claude.ai/artifact/FYGze8ZbjwrqhN4ioWvnkb). El usuario eligió la B.

## Alcance

**Dentro:**

- **Icono de Conversaciones: dos bocadillos que se responden** (propuesta B).
  - SVG propio de 24×24 y trazo 2, como lucide y `StatusPulseIcon`, en `apps/web/src/app/chat-reply-icon.tsx`. Dos clases CSS animadas en `index.css` (`.chat-in`, `.chat-out`).
  - Bucle de 2,4 s:
    - el bocadillo del cliente aparece (0–12 %);
    - después aparece la respuesta (32–46 %);
    - se mantienen los dos y se desvanecen (82–100 %).
  - El segundo bocadillo tapa al primero con el fondo de su botón. El rail y la barra móvil exponen ese fondo en `--nav-icon-bg`, con un valor para inactivo y otro para activo.
  - Se anima siempre, como Estado.
  - Con `prefers-reduced-motion: reduce` queda quieto, con los dos bocadillos visibles.
  - Sustituye a `MessageSquare` en `NAV_ITEMS`. Así cambia en el rail y en la barra inferior móvil.
- **`/settings/members` (Owner y Admin):**
  - **Cabecera:** título "Miembros", subtítulo, y el botón "Invitar" con el `InviteDialog` actual.
  - **Pestañas** con `SegmentedControl`: "Miembros (n)" e "Invitaciones (n)". La pestaña activa va en la URL (`?tab=invitations`; sin parámetro, Miembros).
  - **Buscador** sobre la lista de miembros. Filtra por nombre o email, sin distinguir mayúsculas ni tildes. Sin resultados: "Nadie coincide con «…»".
  - **Fila de miembro**, una rejilla de columnas fijas igual en todas las filas:
    - avatar (con la foto de SPEC 15) con nombre y "(tú)";
    - email en gris debajo del nombre, solo lectura;
    - rol;
    - menú de acciones "⋯".
  - **Rol:**
    - El Owner ve un menú desplegable con los tres roles y una línea de descripción en cada uno:
      - **Owner:** "Todo, incluida la empresa".
      - **Admin:** "Miembros, canales y todas las conversaciones".
      - **Agent:** "Atiende sus conversaciones".
    - Los demás ven el rol como insignia.
  - **Menú "⋯":** "Quitar de la empresa", con el `ConfirmDialog` actual. Solo aparece si el actor puede quitar a ese miembro (`canRemoveMember`). Sin acciones, no hay menú y la columna queda vacía, con el mismo ancho.
  - **Fila de invitación:** email, rol como insignia, "Invitó X · vence el D" y "Revocar" (si `canRevokeInvitation`). Sin invitaciones: estado vacío "No hay invitaciones pendientes" con el botón "Invitar".
  - **Móvil (< sm):** la fila se apila. Arriba van el avatar, el nombre y el email, con el menú "⋯" a la derecha; debajo, el rol.
  - **Avisos de error:** se conservan los de hoy (`LAST_OWNER`, `403`).
- **Email de los miembros en el API:**
  - `MemberSchema` gana `email`, y `GET /members` y `PATCH /members/:id` lo devuelven a todos los roles (elegido por el usuario).
  - El email no se puede editar: no hay endpoint ni campo para cambiarlo.
- **`/settings/channels` (Owner y Admin):**
  - **Lista** de canales, una fila por canal:
    - nombre;
    - número;
    - proveedor ("WhatsApp Cloud" o "n8n");
    - insignias de estado;
    - chevron.
  - **Insignias:**
    - "Meta conectado" o "Meta pendiente". Solo en WhatsApp Cloud: `hasWhatsAppCredentials`.
    - "IA activa" o "IA apagada": `aiEnabled` en WhatsApp Cloud; en n8n, activa si tiene `webhookUrl`.
    - "n8n listo" o "n8n pendiente": `webhookUrl && hasCredentials`.
  - **Panel lateral:** tocar una fila abre un `Sheet` a la derecha, de ancho `min(32rem, 100vw)`, que en móvil ocupa toda la pantalla.
    - El canal abierto va en la URL (`?channel=<id>`), así que recargar mantiene el panel.
    - **Cabecera:** el nombre, editable en línea con "Guardar" y "Cancelar", y debajo el número y el proveedor.
    - **Pasos numerados**, cada uno con un indicador de completo o pendiente:
      1. **Conectar Meta** (solo WhatsApp Cloud). La URL del webhook de WhatsApp con "Copiar" y el formulario de access token, app secret y verify token, con los textos y la lógica de hoy. Completo si `hasWhatsAppCredentials`.
      2. **IA con n8n.** El webhook de n8n, editable aquí (sustituye al diálogo "Editar canal"), y el interruptor "Activar respuestas de IA" (solo WhatsApp Cloud). Completo si tiene `webhookUrl` y, en WhatsApp Cloud, además `aiEnabled`.
      3. **Credenciales de n8n.** "Generar credenciales" o "Rotar credenciales", con el `ConfirmDialog` y el diálogo de valores que se muestran una vez, como hoy, y "Probar conexión n8n" con su resultado. Completo si `hasCredentials`.
    - En un canal n8n (legado) no aparece el paso de Meta, y los pasos se renumeran (1 y 2).
    - Los avisos de cada acción ("Credenciales de Meta guardadas.", resultado de la prueba…) van dentro del paso que los produjo.
  - **"Añadir WhatsApp":** abre el diálogo de alta con el formulario de hoy (nombre, número, phone_number_id). Al crear, se cierra y se abre el panel del canal nuevo en el paso 1.
  - **Estados:** cargando con skeleton de filas; error con "Reintentar"; sin canales, estado vacío "Aún no hay canales" con "Añadir WhatsApp".
- Se conservan todos los permisos y endpoints de canales de hoy. No cambia el API de canales.

**Fuera:**

- Animar otros iconos, o que el de Conversaciones refleje datos (no leídos, conversaciones abiertas).
- Editar el email de un miembro, ocultarlo según el rol, o buscar por rol.
- Reenviar o copiar el enlace de una invitación (el token solo existe al crearla).
- Paginación de miembros o de canales.
- Borrar canales, cambiar el proveedor o el número de un canal.
- Asistente de alta de Meta (guía paso a paso en la consola de Meta).
- Cambios en `/settings/company`, `/settings/profile` o `/settings/notifications`.

## Modelo de datos

**Contrato (`packages/contracts/src/members.ts`):**

```ts
export const MemberSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  /** Solo lectura en la web (SPEC 17). */
  email: z.email(),
  role: MemberRoleSchema,
  avatarUrl: AvatarUrlSchema,
});
```

- `Member.email` ya existe en el dominio del API (`modules/members/domain/member.ts`). Solo cambian los dos controladores que lo recortan (`members.controller.ts`, `team-members.controller.ts`).
- La prueba "no expone el email" de `members.spec.ts` se sustituye por una que lo exige.
- No hay migración: la columna `tenant_members.email` ya existe.

**Web, sin persistencia nueva:**

- `?tab=invitations` en `/settings/members` y `?channel=<id>` en `/settings/channels`.
- `features/team/model/member-search.ts`: `filterMembers(members, query)` normaliza con `NFD` y quita las tildes.
- `features/channels/model/channel-status.ts`: `channelBadges(channel)` y `channelSteps(channel)` devuelven las insignias y los pasos (número, título, completo) a partir de `Channel`.

## Plan de implementación

1. **Icono.** `chat-reply-icon.tsx`, clases `.chat-in` y `.chat-out` en `index.css` con su bloque de `prefers-reduced-motion`, `--nav-icon-bg` en `nav-rail.tsx` y `bottom-nav.tsx`, y `NAV_ITEMS` con el icono nuevo.
2. **Email en el API.** Contrato, controladores, prueba del contrato y e2e de `GET /members` con `email`.
3. **Miembros: modelo.** `filterMembers` con pruebas unitarias (nombre, email, tildes, vacío).
4. **Miembros: UI.**
   - Separar `members-page.tsx` en `members-page.tsx` (cabecera, pestañas, buscador), `member-row.tsx`, `role-menu.tsx` e `invitation-row.tsx`.
   - Rejilla de columnas, menú "⋯" y vista apilada en móvil.
5. **Canales: modelo.** `channelBadges` y `channelSteps` con pruebas unitarias para WhatsApp Cloud a medias, completo y n8n legado.
6. **Canales: lista y panel.**
   - Separar `channels-page.tsx` en `channels-page.tsx` (lista, estados, alta), `channel-row.tsx` y `channel-panel.tsx` (Sheet, cabecera con nombre editable).
   - Los pasos van en `steps/meta-step.tsx`, `steps/ai-step.tsx` y `steps/credentials-step.tsx`. Se mueve la lógica actual sin cambiar las llamadas al API.
   - `?channel=<id>`. Tras crear, se abre el panel del canal nuevo.
7. **Documentación.** Sección "Verificación de implementación" en este spec.

## Criterios de aceptación

**Icono:**

- [ ] El rail y la barra móvil muestran el icono de dos bocadillos en Conversaciones. El primero aparece, después el segundo, y se desvanecen en bucle de 2,4 s.
- [ ] El segundo bocadillo tapa limpio al primero en el rail inactivo, en el rail activo y en la barra móvil, en tema claro y oscuro.
- [x] Con "reducir movimiento" activado en el sistema, el icono queda quieto con los dos bocadillos visibles.

**Miembros:**

- [x] `GET /api/v1/members` devuelve `email` en cada miembro, también a un Agent. No existe forma de editarlo.
- [x] En `/settings/members`, avatar, rol y menú "⋯" quedan en la misma columna en todas las filas, con nombres de distinta longitud y con miembros sin acciones.
- [x] Cada fila muestra el email bajo el nombre.
- [x] Las pestañas muestran "Miembros (n)" e "Invitaciones (n)" con los números reales. `?tab=invitations` abre la segunda, y recargar la conserva.
- [ ] Buscar "jose" encuentra a "José" y buscar parte de un email lo encuentra. Sin coincidencias aparece "Nadie coincide con «…»".
- [ ] El Owner cambia el rol desde un menú con la descripción de cada rol. Un Admin ve el rol como insignia.
- [ ] "Quitar de la empresa" está en el menú "⋯" y pide confirmación. `LAST_OWNER` sigue mostrando su aviso.
- [x] A 400 px de ancho no hay scroll horizontal y cada fila se apila (nombre y email arriba, rol abajo).

**Canales:**

- [ ] `/settings/channels` lista los canales con sus insignias correctas: un canal WhatsApp Cloud sin secretos muestra "Meta pendiente" y uno con secretos e IA muestra "Meta conectado" e "IA activa".
- [ ] Tocar un canal abre el panel lateral con la URL `?channel=<id>`, y recargar lo deja abierto.
- [x] El panel de un canal WhatsApp Cloud muestra los pasos 1 Conectar Meta, 2 IA con n8n y 3 Credenciales, con su indicador de completo o pendiente. El de un canal n8n muestra solo dos pasos.
- [ ] Renombrar el canal desde la cabecera y cambiar el webhook de n8n desde el paso 2 se guardan sin el diálogo "Editar canal", que ya no existe.
- [ ] Guardar secretos de Meta, activar la IA, generar o rotar credenciales y probar la conexión funcionan como antes, y su aviso aparece dentro del paso.
- [ ] Crear un canal con "Añadir WhatsApp" abre su panel en el paso 1.
- [ ] Sin canales aparece "Aún no hay canales" con "Añadir WhatsApp".

**General:**

- [x] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: icono B, dos bocadillos que se responden** (elegido por el usuario tras ver las cuatro animadas). Se descartaron A (puntos "escribiendo"), C (onda roja, que se lee como "hay no leídos") y D (líneas que se escriben).
- **Sí: el icono se anima siempre, como Estado** (elegido por el usuario). Se descartaron animarlo solo con la ruta activa o solo con conversaciones abiertas.
- **Sí: fondo del botón en `--nav-icon-bg`.** El segundo bocadillo necesita relleno para tapar al primero; un relleno fijo se vería como un parche en el botón activo.
- **Sí: Miembros con pestañas y filas alineadas** (elegido por el usuario), frente a una rejilla de tarjetas o solo corregir la alineación.
- **Sí: el email se ve y no se edita** (petición del usuario).
- **Sí: el email llega a todos los roles** (elegido por el usuario). Se descartó enviarlo solo a Owner y Admin. Esto revierte la decisión de SPEC 07 de no exponer emails a los agentes.
- **Sí: Canales con lista y panel lateral** (elegido por el usuario), frente a mantener el acordeón con pasos o una página por canal.
- **Sí: editar nombre y webhook dentro del panel** (elegido por el usuario). Desaparece el diálogo "Editar canal".
- **Sí: tras crear un canal se abre su panel en el paso 1** (elegido por el usuario).
- **Sí: pestaña y canal abierto en la URL** (`?tab=`, `?channel=`). Es lo que ya hace la bandeja con sus pestañas. Permite recargar o compartir el enlace sin perder el contexto.
- **No: cambios en el API de canales.** Las insignias y los pasos salen de los campos que `Channel` ya expone.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Exponer el email a los Agent es un cambio de privacidad respecto a SPEC 07. | Es la decisión del usuario, anotada arriba. Solo lo ven miembros de la misma empresa (`GET /members` usa la empresa activa). |
| El relleno del segundo bocadillo no coincide con el fondo en algún estado (hover, foco). | `--nav-icon-bg` se define en cada estado del botón, incluido hover. El criterio de aceptación lo revisa en claro y oscuro. |
| Mover la lógica de canales a varios archivos rompe un flujo que hoy funciona (secretos, rotación, prueba). | El paso 6 mueve el código sin cambiar las llamadas al API. El criterio "funcionan como antes" se prueba a mano con un canal real o simulado. |
| `?channel=<id>` de un canal que ya no existe o de otra empresa. | El panel no se abre y el parámetro se quita de la URL. |
| Un `Sheet` ancho en tablets tapa la lista. | Es el comportamiento buscado. Se cierra con Esc, tocando fuera o con la X. |

## Qué **no** entra en este spec

- Icono con datos, u otros iconos animados.
- Editar el email, ocultarlo por rol, reenviar invitaciones o paginar.
- Borrar canales o cambiar su proveedor o número.
- Asistente de Meta.
- Cambios en Empresa, Mi perfil o Notificaciones.

Cada uno de esos, si llega, va en su propio spec.

## Verificación de implementación

2026-10-14, rama `spec-17-pulido-ui`.

Automatizado, en verde:

- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` en todo el monorepo: 347 unitarias del API, 153 de la web y 104 de contratos. El único aviso de lint (`main.tsx`) ya estaba en `main`.
- `pnpm --filter @omnidesk/api test:e2e` desde el host contra el Postgres local (`_e2e`): 188 pruebas, 187 pasaron y 1 se saltó (MinIO).
- La e2e de `GET /members` de `assignment.e2e-spec.ts` ahora exige el email (antes exigía que no hubiera ninguno) y añade un caso: un Agent recibe el email de sus compañeros.
- Unitarias nuevas: `filterMembers` (nombre, email, tildes, vacío) y `channelBadges`/`channelSteps` (WhatsApp Cloud a medias, completo y n8n).

Capturas con Playwright contra el stack local (`localhost:8088`), como Owner demo, con "reducir movimiento" activo, a 1280 px y 400 px:

- **Miembros:**
  - Las filas quedan alineadas, también la del Owner, que no tiene menú "⋯".
  - El email aparece bajo el nombre.
  - Las pestañas muestran "Miembros (2)" e "Invitaciones (0)", y `?tab=invitations` abre la segunda con su estado vacío.
  - En móvil la fila se apila.
- **Sin scroll horizontal:** en ninguna de las tres vistas, a ninguno de los dos anchos.
- **Canales:**
  - Insignias en la lista.
  - Tocar un canal abre el panel con `?channel=<id>`.
  - Un canal WhatsApp Cloud muestra tres pasos y el canal demo (simulado) muestra dos.
  - El panel ocupa toda la pantalla a 400 px.
- **Icono:** quieto, con los dos bocadillos visibles en el rail y en la barra móvil.

Corrección durante la verificación:

- El paso "IA con n8n" trataba el canal demo (`SIMULATED`) como n8n y exigía el webhook. Ahora el texto "Webhook n8n de envío" y la obligatoriedad solo aplican a `provider === 'N8N'`, como antes.

Detalles de implementación que el spec no fijaba:

- Los campos compartidos (`Field`, `CopyValue`) pasaron a `channel-fields.tsx`.
- Cada paso usa `useStepAction` para su estado de envío y su aviso.
- El alta de canal ya no pide el webhook de n8n: ese campo vive en el paso 2.
- La página de Canales sin acceso usa el mismo `EmptyState` que Miembros.

Sin comprobar en navegador:

- La animación en movimiento y que el relleno del segundo bocadillo tape limpio en hover y en tema oscuro.
- El buscador escribiendo, el menú de rol y "Quitar de la empresa".
- Renombrar desde la cabecera, guardar el webhook, guardar secretos de Meta, activar la IA, rotar credenciales y probar la conexión.
- Recargar con el panel abierto.
- El alta de un canal y la apertura de su panel.
- El estado vacío de Canales y un canal WhatsApp Cloud con IA activa.
