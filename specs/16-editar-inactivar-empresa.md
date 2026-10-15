# SPEC 16 — Editar, dar logo e inactivar una empresa

> **Status:** Approved
> **Depends on:** SPEC 07, SPEC 13, SPEC 14, SPEC 15
> **Date:** 2026-10-14
> **Objective:** El Owner edita el nombre, el slug y el logo de su empresa desde `/settings/company`, y puede inactivarla (se corta la atención, el acceso de Admin y Agent y todo envío) y reactivarla después.

## Por qué existe este spec

Hoy una empresa no se puede tocar después del alta. `Tenant` solo tiene `id`, `slug`, `name` y `createdAt`, y el único endpoint es `POST /api/v1/tenants`. No hay forma de corregir el nombre, de identificarla con un logo, ni de pausar una empresa que deja de usar OmniDesk sin borrar sus datos.

Inactivar no es borrar. Los datos se conservan y el Owner puede reactivarla. El borrado de datos es cosa de la retención (SPEC 12).

Este spec es el segundo de los que salieron de la petición del 2026-10-14. El pulido de UI (icono de Conversaciones, Miembros y Canales) va en SPEC 17.

## Alcance

**Dentro:**

- **Pantalla `/settings/company`** ("Empresa"). Solo Owner. Entrada "Empresa" en "Ajustes de <empresa>" del menú del avatar, visible solo para Owner. Tres bloques:
  - **Datos:** nombre (2–80 caracteres) y slug (`TenantSlugSchema`). Guardar responde `409 SLUG_TAKEN` si el slug ya existe.
  - **Logo:** subir, cambiar y quitar.
  - **Zona de peligro:** "Inactivar empresa".
- **Logo**, igual que la foto de SPEC 15:
  - La web recorta en cuadrado (`cropShape="rect"`), con salida 512×512 en WebP o JPEG.
  - El API valida por bytes y con un máximo de 1 MB, y lo guarda en MinIO bajo `tenants/<tenantId>/logo-<uuid>`. Al cambiarlo o quitarlo, se borra el objeto anterior.
  - Se ve en el selector de empresas del menú del avatar y en la cabecera del rail de escritorio, que sustituye al logo de OmniDesk. También se ve en `/settings/company` y en la pantalla pública `/invite/:token`.
  - Sin logo, se muestran las iniciales con el color estable de hoy (`TenantMark`).
- **Empresa demo** (slug `demo`): su slug no se puede cambiar (`409 DEMO_SLUG_LOCKED`). Nombre, logo e inactivación sí. Inactiva, el login de desarrollo no muestra sus miembros y `dev-login` responde `404`.
- **Inactivar** (`POST /api/v1/tenants/current/deactivate { confirmName }`), solo Owner:
  - Diálogo que explica qué se corta y exige escribir el nombre exacto de la empresa. Si no coincide, el API responde `400 CONFIRMATION_MISMATCH`.
  - En una transacción:
    1. Fija `deactivatedAt` y `deactivatedByMemberId`.
    2. Revoca todas las invitaciones pendientes.
    3. Encola `tenant.status_changed` para el tiempo real.
  - Inactivar una empresa ya inactiva responde `200` sin cambios.
- **Con la empresa inactiva:**
  - **Acceso:**
    - Admin y Agent dejan de verla en `/me` y en el selector.
    - Los Owner la ven marcada "Inactiva" en el selector. Al elegirla, solo acceden a `/settings/company`, que muestra el aviso "Inactivada por X el D" y el botón "Reactivar".
    - El resto de rutas del API responden `403 TENANT_INACTIVE`.
  - **Sesiones:** una sesión de Admin o Agent con esa empresa activa pasa a su primera empresa activa, o a `/onboarding` si no tiene ninguna. Es el mecanismo actual de `GetMeUseCase`.
  - **Tiempo real:** las apps abiertas reciben `tenant.status_changed` y vuelven a pedir `/me`. Las de Admin y Agent salen de la empresa al momento. El gateway rechaza unirse a la sala de una empresa inactiva salvo a sus Owner.
  - **WhatsApp entrante:** el webhook lo registra como hoy, con contacto, conversación, mensaje y adjunto. No encola `ai.reply_requested` ni `notification.requested`. Al reactivar, la bandeja está completa.
  - **Envíos:**
    - No se acepta nada nuevo. La IA (n8n) recibe `409 { sendAllowed: false, reason: 'TENANT_INACTIVE' }`.
    - El dispatcher del Outbox marca `FAILED` con motivo `TENANT_INACTIVE`, sin llamar al proveedor, todo `message.send_requested` de una empresa inactiva, incluidos los que ya estaban en cola.
    - Los `ai.reply_requested` y `notification.requested` pendientes se publican sin efecto.
    - `attachment.download_requested` sigue: es entrante.
  - **Invitaciones:** aceptar una de esa empresa responde `409 TENANT_INACTIVE`. Ya no debería quedar ninguna pendiente.
- **Reactivar** (`POST /api/v1/tenants/current/reactivate`), solo Owner. En una transacción:
  1. Limpia `deactivatedAt` y `deactivatedByMemberId`.
  2. Vuelve a `PENDING` y reencola los mensajes salientes `FAILED` con motivo `TENANT_INACTIVE` cuya conversación sigue abierta y con la ventana de 18 h abierta (`canSendNow`). Los demás se quedan `FAILED`.
  3. Encola `tenant.status_changed`.
- **Endpoints nuevos** (todos de la empresa activa de la sesión, salvo los de logo por id o por token):
  - `GET /api/v1/tenants/current` → `TenantDetails`.
  - `PATCH /api/v1/tenants/current { name?, slug? }`.
  - `PUT /api/v1/tenants/current/logo` (multipart `file`) y `DELETE /api/v1/tenants/current/logo`.
  - `POST /api/v1/tenants/current/deactivate` y `POST /api/v1/tenants/current/reactivate`.
  - `GET /api/v1/tenants/:id/logo?v=`: a miembros activos de esa empresa, y a sus Owner aunque esté inactiva. Cabeceras como la foto de SPEC 15.
  - `GET /api/v1/invitations/:token/logo?v=`: sin sesión, solo si la invitación está vigente.
- **`/me`:** cada membresía gana `tenantLogoUrl` y `tenantActive`.

**Fuera:**

- Borrar una empresa o sus datos (SPEC 12).
- Transferir la propiedad, o que Admin edite los datos de la empresa.
- Inactivación programada o automática (por impago, por inactividad).
- Avisar por email o push a los miembros de que la empresa se inactivó.
- Reintentar las respuestas de IA que no se generaron mientras estuvo inactiva.
- Desconectar los canales de Meta o revocar las credenciales de n8n al inactivar.
- Logo en la barra inferior móvil, en el login o en las notificaciones push.
- Historial de cambios de nombre, slug o logo.

## Modelo de datos

**Prisma:**

```prisma
model Tenant {
  id                    String    @id @default(uuid(7)) @db.Uuid
  slug                  String    @unique
  name                  String
  /// Clave del logo en el bucket; null sin logo.
  logoKey               String?   @map("logo_key")
  /// Versiona la URL del logo para la caché.
  logoUpdatedAt         DateTime? @map("logo_updated_at") @db.Timestamptz(3)
  /// null = activa.
  deactivatedAt         DateTime? @map("deactivated_at") @db.Timestamptz(3)
  deactivatedByMemberId String?   @map("deactivated_by_member_id") @db.Uuid
  createdAt             DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  deactivatedBy TenantMember? @relation("TenantDeactivatedBy", fields: [deactivatedByMemberId], references: [id], onDelete: Restrict)
  // … relaciones sin cambios
}
```

- La migración solo añade columnas nulas. Todas las empresas existentes quedan activas.
- Clave del logo: `tenants/<tenantId>/logo-<uuid>`, nueva en cada subida, en el bucket de SPEC 14.

**Contratos (`@omnidesk/contracts`):**

```ts
// tenants.ts
export const UpdateTenantRequestSchema = z
  .object({ name: z.string().trim().min(2).max(80), slug: TenantSlugSchema })
  .partial()
  .refine((value) => value.name !== undefined || value.slug !== undefined);

export const TenantDetailsSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  /** `null` = activa. */
  deactivatedAt: z.iso.datetime().nullable(),
  deactivatedBy: MemberRefSchema.nullable(),
  /** La demo no cambia de slug. */
  slugLocked: z.boolean(),
});

export const DeactivateTenantRequestSchema = z.object({ confirmName: z.string() });

export function tenantLogoPath(tenantId: string, version: number): string; // `/api/v1/tenants/${id}/logo?v=${version}`
export function invitationLogoPath(token: string, version: number): string; // `/api/v1/invitations/${token}/logo?v=${version}`

// auth.ts — MembershipSchema gana:
tenantLogoUrl: z.string().nullable().default(null),
tenantActive: z.boolean().default(true),

// invitations.ts — InvitationPreviewSchema gana:
tenantLogoUrl: z.string().nullable().default(null),

// realtime.ts — evento nuevo en la sala de la empresa:
// 'tenant.status_changed' → { tenantId: string; active: boolean }

// errors.ts — códigos nuevos:
// 'TENANT_INACTIVE' | 'CONFIRMATION_MISMATCH' | 'DEMO_SLUG_LOCKED'
```

- `TENANT_INACTIVE_REASON = 'TENANT_INACTIVE'` es el `failureReason` de los mensajes cortados.
- `/me` sigue ordenando las membresías por nombre. La primera empresa *activa* es la de respaldo al cambiar la sesión.

## Plan de implementación

1. **Utilidades compartidas.**
   - La detección de JPEG/WebP por bytes pasa de `modules/profile/domain/avatar-image.ts` a `shared/kernel/image-type.ts` (`detectImageMimeType`).
   - El recorte de la web pasa a `shared/ui/image-crop-dialog.tsx`, con la prop `shape: 'round' | 'rect'`, y `shared/lib/crop-to-blob.ts`. Mi perfil los usa sin cambio visible.
   - Sin cambios de comportamiento: las pruebas de SPEC 15 siguen en verde.
2. **Modelo y contratos.** Migración de `Tenant`, esquemas y helpers de arriba, y códigos de error. `tenantActive` y `tenantLogoUrl` con `default`, para no romper la web actual.
3. **Editar datos.** `GET` y `PATCH /tenants/current`, solo Owner, con `SLUG_TAKEN` y `DEMO_SLUG_LOCKED`. Pruebas unitarias de la política y e2e.
4. **Logo en el API.** `PUT` y `DELETE /tenants/current/logo`, `GET /tenants/:id/logo` y `GET /invitations/:token/logo`. `tenantLogoUrl` en `/me` y en el preview de la invitación. E2E: subir, cambiar (borra el anterior), quitar, `404` a un ajeno y token vencido.
5. **Inactivar y reactivar (API).** Casos de uso con la transacción descrita, confirmación por nombre, revocación de invitaciones y evento `tenant.status_changed`.
6. **Corte de acceso.**
   - `/me` filtra según rol y estado. `GetMeUseCase` cae a la primera empresa activa.
   - `SessionGuard` responde `403 TENANT_INACTIVE` salvo en `/tenants/current*` y `/tenants/:id/logo` para Owner.
   - El gateway no deja unirse a la sala salvo a los Owner.
   - Aceptar una invitación responde `409`. `dev-login` y `/auth/providers` ignoran la demo inactiva.
7. **Corte de atención.**
   - `RegisterInboundMessage` no encola IA ni notificaciones si la empresa está inactiva.
   - El dispatcher marca `FAILED`/`TENANT_INACTIVE` los envíos y publica sin efecto la IA y el push.
   - La respuesta de la IA recibe `409 TENANT_INACTIVE`.
   - E2E de punta a punta: entra un mensaje, se guarda, no hay `ai.reply_requested` y un envío en cola falla.
8. **Reactivar reencola.** Los `FAILED`/`TENANT_INACTIVE` con conversación abierta y ventana abierta vuelven a `PENDING` con su `message.send_requested`, y los demás no. E2E con ventana abierta y cerrada.
9. **Web: logo.** Componente `TenantMark` (logo o iniciales) en el selector (`account-menu-items.tsx`), en la cabecera del rail (`nav-rail.tsx`, en lugar de `logo.svg`) y en `/invite/:token`.
10. **Web: `/settings/company`.**
    - `features/company/` con `company-page.tsx`, `company-api.ts` y `deactivate-dialog.tsx`.
    - Ruta en `router.tsx` y entrada "Empresa" solo para Owner.
    - Bloques Datos, Logo y Zona de peligro.
11. **Web: empresa inactiva.**
    - El selector marca "Inactiva".
    - Con la empresa activa inactiva, `AppLayout` lleva cualquier ruta a `/settings/company`, que solo muestra el aviso y "Reactivar".
    - Al recibir `tenant.status_changed`, la app vuelve a pedir `/me`.
12. **Documentación.** Sección "Verificación de implementación" en este spec.

## Criterios de aceptación

- [ ] Un Owner ve "Empresa" en "Ajustes de <empresa>". Admin y Agent no lo ven y `GET /tenants/current` les responde `403`.
- [ ] Cambiar el nombre se refleja en el selector y en el rail sin recargar.
- [ ] Cambiar el slug a uno libre responde `200`; a uno ocupado, `409 SLUG_TAKEN`; el de la demo, `409 DEMO_SLUG_LOCKED`.
- [ ] Subir un logo lo muestra en el selector, en el rail y en `/settings/company`. Cambiarlo o quitarlo borra el objeto anterior del bucket.
- [ ] Sin logo, el rail y el selector muestran las iniciales con el color de hoy.
- [ ] `/invite/:token` muestra el logo con una invitación vigente. `GET /invitations/:token/logo` responde `404` con un token vencido, revocado o desconocido.
- [ ] `GET /tenants/:id/logo` responde `404` a quien no es miembro activo de esa empresa (salvo sus Owner si está inactiva).
- [ ] Inactivar con un nombre distinto responde `400 CONFIRMATION_MISMATCH` y no cambia nada.
- [ ] Tras inactivar, las invitaciones pendientes quedan revocadas.
- [ ] Tras inactivar, un Agent con la app abierta sale de la empresa en menos de 5 s sin recargar. Su siguiente `/me` no incluye esa empresa.
- [ ] Un Agent cuya única empresa se inactiva termina en `/onboarding`.
- [ ] Un Owner ve la empresa como "Inactiva" en el selector. Al elegirla, cualquier ruta lo lleva a `/settings/company` con "Reactivar". El resto del API le responde `403 TENANT_INACTIVE`.
- [ ] Un mensaje de WhatsApp que llega con la empresa inactiva queda guardado, sin `ai.reply_requested` ni `notification.requested`.
- [ ] Un `message.send_requested` en cola al inactivar termina `FAILED` con `TENANT_INACTIVE` sin llamar al proveedor.
- [ ] La respuesta de la IA a una empresa inactiva recibe `409 { sendAllowed: false, reason: 'TENANT_INACTIVE' }`.
- [ ] Aceptar una invitación de una empresa inactiva responde `409 TENANT_INACTIVE`.
- [ ] Con la demo inactiva, `/auth/providers` no lista sus miembros y `dev-login` responde `404`.
- [ ] Reactivar devuelve el acceso a Admin y Agent y reencola los `TENANT_INACTIVE` con la ventana de 18 h abierta. Los que tienen la ventana cerrada siguen `FAILED`.
- [ ] Inactivar o reactivar dos veces seguidas responde `200` y no duplica eventos ni reencolados.
- [ ] Lint, typecheck, test, build y e2e pasan.

## Decisiones tomadas y descartadas

- **Sí: nombre, slug y logo editables** (elegido por el usuario). Se recomendó solo el nombre, porque el slug no aparece en URLs. Se acepta el slug con la demo bloqueada.
- **Sí: solo Owner edita e inactiva** (elegido por el usuario). Se descartó que Admin editara los datos.
- **Sí: Owner ve la empresa inactiva solo para reactivarla** (elegido por el usuario). Se descartaron "todos en solo lectura" y "nadie la ve" (sin vuelta atrás desde la app).
- **Sí: el entrante se guarda, sin IA ni avisos** (elegido por el usuario). Se descartaron descartar el mensaje (se pierde) y rechazarlo para que Meta reintente (se pierde igual a los ~7 días).
- **Sí: cortar todo envío, incluido lo encolado** (elegido por el usuario). Tras inactivar no sale nada.
- **Sí: logo igual que la foto de SPEC 15** (elegido por el usuario), pero en recorte cuadrado. Por eso el recorte y la detección por bytes se mueven a `shared/` en el paso 1.
- **Sí: el logo de la empresa sustituye al de OmniDesk en el rail** (elegido por el usuario). OmniDesk sigue en el login y en el icono de la app.
- **Sí: logo de la invitación por token** (elegido por el usuario). No hay logos públicos por id.
- **Sí: confirmar escribiendo el nombre** (elegido por el usuario), comprobado también en el API.
- **Sí: salida inmediata por Socket.IO** (elegida por el usuario) con `tenant.status_changed`. El `403` en la siguiente petición queda como respaldo.
- **Sí: revocar las invitaciones pendientes al inactivar** (elegido por el usuario). Al reactivar hay que invitar de nuevo.
- **Sí: `deactivatedAt` y `deactivatedByMemberId`** (elegido por el usuario), frente a solo la fecha o un enum de estado.
- **Sí: reencolar solos los fallidos al reactivar** (elegido por el usuario), solo con la conversación abierta y la ventana de 18 h abierta. Así se respeta la regla de SPEC 14.
- **Sí: todo en un solo spec** (elegido por el usuario), frente a separar el logo en otro.
- **Sí: la demo conserva su slug pero se puede inactivar** (elegido por el usuario). El login de desarrollo depende de `demo`.
- **Sí: ser Owner de una empresa inactiva sigue permitiendo crear otra** (`canCreateTenant` no mira el estado). Inactivar no quita el rol.
- **No: reintentar las respuestas de IA perdidas.** El cliente ya escribió hace tiempo; una respuesta automática tardía confunde más que ayuda.

## Riesgos identificados

| Riesgo | Mitigación |
| --- | --- |
| Un envío está en vuelo hacia Meta justo al inactivar. | El dispatcher mira el estado antes de llamar al proveedor. Uno ya enviado termina normal. Es una ventana de segundos y se acepta. |
| El chequeo de estado añade una consulta a cada petición con sesión. | `ResolveActor` ya lee la membresía. Se amplía esa misma consulta con `tenant.deactivatedAt` en lugar de añadir otra. |
| Reactivar tras muchas horas reencola mensajes que el cliente ya no espera. | Solo se reencolan los que tienen la ventana de 18 h abierta. Es la decisión del usuario y queda documentada. |
| El webhook sigue escribiendo en una empresa inactiva durante meses. | Es lo elegido: los datos se conservan. La retención de SPEC 12, cuando exista, aplica igual. |
| Cambiar el slug de la demo rompe el login de desarrollo. | Bloqueado en el API (`DEMO_SLUG_LOCKED`) y en la web (`slugLocked`). |
| Mover el recorte y la detección a `shared/` toca código de SPEC 15. | Es el paso 1, sin cambio de comportamiento, cubierto por las pruebas de SPEC 15. |
| SPEC 15 aún no está fusionada en `main`. | Este spec depende de ella. Se implementa después de fusionar `spec-15-foto-de-perfil`. |

## Qué **no** entra en este spec

- Borrar la empresa o sus datos.
- Transferir la propiedad, o que Admin edite la empresa.
- Inactivación automática o programada.
- Avisos a los miembros por email o push.
- Reintentar respuestas de IA perdidas.
- Desconectar Meta o revocar las credenciales de n8n.
- Logo en la barra móvil, en el login o en push.
- **Icono animado de Conversaciones, rediseño de `/settings/members` y de `/settings/channels`:** van en SPEC 17.

Cada uno de esos, si llega, va en su propio spec.
