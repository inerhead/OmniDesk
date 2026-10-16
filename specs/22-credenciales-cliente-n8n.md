# SPEC 22 — Credenciales de cliente en las llamadas a n8n

> **Status:** Approved
> **Depends on:** SPEC 09, SPEC 17
> **Date:** 2026-10-16
> **Objective:** Toda llamada de OmniDesk al webhook de n8n (`ai.reply`, `ping` y `message.send`) se autentica con `X-Client-Id` (el id del canal) y un `X-Client-Secret` que OmniDesk genera en el paso "IA con n8n"; sustituyen a la firma `X-OmniDesk-Signature` y reemplazan al paso "Credenciales de n8n", que desaparece.

## Por qué existe este spec

Sale de la petición del 2026-10-16: "al llamar la AI a n8n se envíe clientId y clientSecret".

Hoy OmniDesk firma cada llamada a n8n con el secreto HMAC del canal (`X-OmniDesk-Signature`). Ese secreto lo genera OmniDesk en el paso "3. Credenciales de n8n", junto a una API key. El workflow de n8n tiene que verificar la firma con un nodo Code y el cuerpo crudo.

El usuario quiere que n8n reciba un par `clientId` / `clientSecret` que n8n valide con su autenticación por cabecera. La firma deja de enviarse.

Hay un cambio sin commitear en `main` que manda `X-Client-Id: <channelId>` y `X-Client-Secret: <secreto HMAC>`. Este spec lo sustituye: el secreto es nuevo y el secreto HMAC no viaja en claro.

**Enmienda del 2026-10-16 (durante la implementación).** La primera versión pedía que la empresa escribiera el par. El usuario lo cambia: el `clientId` es siempre el id del canal y OmniDesk genera el `clientSecret`. Son los valores que el usuario guarda y valida en n8n. Las secciones de abajo ya reflejan la enmienda; la decisión anterior queda en "Decisiones".

Lo que ya fijaron otros specs y aquí no se reabre:

- Cifrado de secretos de canal con `CHANNEL_SECRETS_KEY` y `ChannelSecretCipher` (SPEC 09).
- Contrato de `ai.reply`, `ping` y `message.send`, timeout de 10 s, `Idempotency-Key`, reintentos por Outbox y no seguir redirecciones (SPEC 09).
- Política de `webhookUrl` contra SSRF (SPEC 09).
- `canManageChannels`: OWNER y ADMIN gestionan canales (SPEC 07).
- Estructura de pasos del panel de canal (SPEC 17).
- Los endpoints de integración entrantes (n8n → OmniDesk) de los canales N8N: `Authorization: Bearer <apiKey>` y firma HMAC entrante (SPEC 09).

## Alcance

**Dentro:**

- **Datos del canal.** Una columna nueva en `channels`:
  - `n8n_client_secret_enc`: cifrado con `ChannelSecretCipher`, nunca se devuelve por la API salvo en la respuesta que lo genera.
  - El `clientId` no se guarda: es siempre `channels.id`.
- **Formato del secreto:** `ncs_` seguido de 32 bytes aleatorios en base64url (47 caracteres).
- **Generar o regenerar (`POST /api/v1/channels/:id/n8n-client`):**
  - Solo OWNER y ADMIN (`canManageChannels`); si no, `403`. Canal de otra empresa o inexistente, `404`.
  - Sin cuerpo. Genera un secreto nuevo, lo guarda cifrado y responde `201 { clientId, clientSecret }`.
  - Es la única vez que se ve el secreto.
  - Si ya había uno, el anterior deja de valer al instante: no hay periodo de gracia.
- **Quitar (`DELETE /api/v1/channels/:id/n8n-client`):**
  - Solo OWNER y ADMIN.
  - Pone `n8n_client_secret_enc` a `null` y `ai_enabled = false`.
  - Responde `200` con el `Channel` actualizado. Repetirlo sin secreto responde `200` sin cambios.
- **Cabeceras en las tres llamadas a n8n** (`ai.reply` en `AiReplyWorker`, `ping` en `HttpChannelWebhookTester` y `message.send` en `N8nMessagingProvider`):
  - `X-Client-Id: <channelId>` y `X-Client-Secret: <clientSecret descifrado>`.
  - Se mantienen `Content-Type: application/json` e `Idempotency-Key` donde ya estaban.
  - **No** se envía `X-OmniDesk-Signature`.
  - El cuerpo de cada llamada no cambia.
- **Sin secreto de cliente:**
  - `ai.reply`: el worker no llama a n8n y no hace nada, como hoy sin webhook. El mensaje queda en Sin asignar.
  - `ping` (`POST /api/v1/channels/:id/test`): responde `ok: false`, `httpStatus: null` y `error: 'El canal no tiene credenciales de cliente de n8n'`, sin llamar.
  - `message.send` (canales N8N): lanza `ChannelNotConfiguredError` y el mensaje queda `FAILED`, como hoy sin `webhookUrl`.
- **Activar la IA** (`PATCH /api/v1/channels/:id/whatsapp { aiEnabled: true }`):
  - Exige `webhookUrl` y `n8n_client_secret_enc`. Ya no exige el secreto HMAC.
  - Si falta algo, `400` con el mensaje "Configura el webhook de IA y las credenciales de cliente antes de activarla".
- **Migración:**
  - Añade la columna, nula.
  - Pone `ai_enabled = false` en todos los canales, porque ninguno tiene aún secreto de cliente.
  - Las columnas de HMAC y la tabla `integration_credentials` no se tocan.
- **Contrato (`packages/contracts/src/channels.ts`):**
  - `ChannelSchema`: añade `hasN8nClientSecret: boolean`; quita `hasCredentials`. El `clientId` es el `id` que ya trae.
  - Nuevo `N8nClientCredentialsResponseSchema { clientId, clientSecret }`.
  - `CreateChannelRequestSchema`: `provider` solo admite `'WHATSAPP_CLOUD'`; se quitan `webhookUrl` y su `refine`.
  - Se elimina `ChannelCredentialsResponseSchema`.
- **Canales N8N:**
  - No se pueden crear nuevos: `POST /api/v1/channels` con `provider: 'N8N'` responde `400` por validación del contrato.
  - Los existentes siguen funcionando con su API key y su HMAC vigentes en los endpoints de integración entrantes.
  - Para enviar (`message.send`) necesitan secreto de cliente, que se genera en su paso "IA con n8n".
- **Endpoint eliminado:** `POST /api/v1/channels/:id/credentials` desaparece y responde `404`. Se borran `IssueChannelCredentialsUseCase`, `newChannelCredentials` y su ruta.
- **Web, paso "IA con n8n"** (`apps/web/src/features/channels/steps/ai-step.tsx`), en todos los proveedores:
  - "Client ID" en solo lectura con botón Copiar: el id del canal.
  - Estado del secreto: "Client secret configurado" o "Sin client secret".
  - Botón "Generar client secret" (sin secreto) o "Regenerar client secret" (con secreto). Regenerar pide confirmación con `ConfirmDialog`: "El secreto actual deja de valer al instante. Tendrás que actualizarlo en n8n."
  - Tras generar, un diálogo muestra el Client ID y el Client secret con Copiar y el aviso "No volverás a verlo. Cópialo antes de cerrar.", con el botón "Ya lo guardé".
  - Botón "Quitar client secret", con `ConfirmDialog` ("La IA se apagará en este canal"). Aviso "Client secret quitado.".
  - Botón "Probar conexión", movido desde el paso de credenciales, con la misma presentación del resultado. Deshabilitado sin `webhookUrl` y `hasN8nClientSecret`.
  - El interruptor "Activar respuestas de IA" (WhatsApp Cloud) se habilita con webhook y secreto.
  - El texto de ayuda pasa a: "Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el webhook de n8n y genera el client secret."
  - El paso está completo con webhook, `hasN8nClientSecret` y, en WhatsApp Cloud, la IA activa.
- **Web, paso "Credenciales de n8n":** se elimina en todos los canales.
  - Se borran `steps/credentials-step.tsx` e `issueCredentials` de `channels-api.ts`.
  - `channelSteps` deja de devolver la clave `'credentials'`. WhatsApp Cloud queda con 2 pasos y N8N con 1.
  - La insignia "n8n listo" pasa a significar webhook + `hasN8nClientSecret`.
- **Firma saliente:** `postSignedJson` (`shared/infrastructure/http/signed-webhook.ts`) pasa a `postJson`, sin firma. `signPayload` se conserva porque lo usa el simulador.
- **Documentación y workflow:**
  - `docs/integracion-n8n.md`: la petición lleva `X-Client-Id` y `X-Client-Secret`; la firma HMAC saliente desaparece; el paso "Generar credenciales" se sustituye por "Generar client secret"; la firma entrante y la API key quedan descritas solo para canales N8N existentes.
  - `tools/n8n/omnidesk-webhook.json`: valida `x-client-id` y `x-client-secret` (el workflow del usuario lo hace contra la tabla de datos `omnidesk_clients`) y responde `401` si no coinciden.

**Fuera de alcance (para futuros specs):**

- Retirar el proveedor N8N por completo, sus endpoints de integración y su secreto HMAC.
- Rotar o revocar la API key de un canal N8N existente.
- Borrar las columnas `hmac_secret_*` y la tabla `integration_credentials`.
- Periodo de gracia con dos secretos de cliente a la vez durante un cambio.
- OAuth o intercambio de token con n8n: el par viaja tal cual en cada llamada.
- Credenciales de cliente distintas por tipo de llamada.
- Elegir un `clientId` distinto del id del canal.
- Ver el secreto después de generarlo.

## Modelo de datos

```prisma
model Channel {
  // …campos actuales sin cambios…
  /// AES-256-GCM: iv (12 B) || ciphertext || tag (16 B). Se envía en `X-Client-Secret`; `X-Client-Id` es `id` (SPEC 22).
  n8nClientSecretEnc Bytes?  @map("n8n_client_secret_enc")
}
```

Migración `apps/api/prisma/migrations/20261026000000_n8n_client_credentials/migration.sql`:

```sql
ALTER TABLE channels ADD COLUMN n8n_client_secret_enc bytea;
UPDATE channels SET ai_enabled = false WHERE ai_enabled;
```

`channels` ya tiene `tenant_id` y política RLS: no hace falta una política nueva.

```ts
// packages/contracts/src/channels.ts
ChannelSchema = z.object({
  // …
  hasN8nClientSecret: z.boolean(),
  // hasCredentials: eliminado
});

/** `POST /api/v1/channels/:id/n8n-client`: el secreto solo aparece en esta respuesta. */
N8nClientCredentialsResponseSchema = z.object({
  clientId: z.uuid(), // = channel.id
  clientSecret: z.string(),
});
```

Cabeceras de cada llamada a `webhookUrl`:

```http
POST <webhookUrl>
Content-Type: application/json
Idempotency-Key: <messageId>        # en ai.reply y message.send
X-Client-Id: <channelId>
X-Client-Secret: <clientSecret>
```

## Plan de implementación

1. **Descartar el cambio en curso.** Revertir en `main` los cinco ficheros modificados (`X-Client-Id: <channelId>` + secreto HMAC). El sistema queda como en `75c6c15`.
2. **Contrato.** Añadir `n8nClientId`, `hasN8nClientSecret` y `ConfigureN8nClientRequestSchema`. Mantener `hasCredentials` de momento. Build de contracts.
3. **Datos.** Columnas en `schema.prisma` y migración (columnas + `ai_enabled = false`). `db:generate`. El repositorio de canales lee las columnas y rellena los dos campos nuevos del `Channel`.
4. **Configurar y quitar.** Casos de uso en `channels/application` y rutas `PUT` y `DELETE …/n8n-client` en `channels.controller.ts`. Pruebas unitarias con la fake del repositorio (permisos, secreto obligatorio la primera vez, conservar al omitir, `DELETE` apaga la IA).
5. **Activar la IA.** `WhatsAppSettings.configure` exige webhook + credenciales de cliente en lugar del HMAC, con el mensaje nuevo.
6. **Envío sin firma.** `postSignedJson` → `postJson` (sin firma, con cabeceras extra). `AiReplyWorker`, `HttpChannelWebhookTester` (y `TestChannelUseCase`) y `N8nMessagingProvider` usan las credenciales de cliente y aplican las reglas "sin credenciales de cliente". Actualizar `n8n-messaging-provider.spec.ts`: hay cabeceras de cliente y no hay `x-omnidesk-signature`.
7. **Web, paso IA.** Campos, guardar, quitar con confirmación y "Probar conexión" en `ai-step.tsx`, con `configureN8nClient` y `removeN8nClient` en `channels-api.ts`. El interruptor y `channelSteps` usan los campos nuevos. El paso de credenciales sigue visible en este punto.
8. **Quitar el paso de credenciales.** Borrar `credentials-step.tsx`, `issueCredentials`, la clave `'credentials'` y su uso en `channel-panel.tsx`. Ajustar insignias y `channel-status.spec.ts`.
9. **Quitar el endpoint y N8N nuevos.** Eliminar la ruta `POST …/credentials`, `IssueChannelCredentialsUseCase` y `newChannelCredentials`. `CreateChannelRequestSchema` solo con `WHATSAPP_CLOUD`. Quitar `hasCredentials` y `ChannelCredentialsResponseSchema` del contrato.
10. **e2e.** En `whatsapp.e2e-spec.ts` y `attachments.e2e-spec.ts`, `enableAi` usa `PUT …/n8n-client`. En `channels.e2e-spec.ts`, las pruebas de `…/credentials` pasan a `n8n-client`. Los canales N8N que necesiten API key se insertan con Prisma. La prueba de IA comprueba `X-Client-Id`, `X-Client-Secret` y que no hay `X-OmniDesk-Signature`.
11. **Docs y workflow.** Actualizar `docs/integracion-n8n.md` y `tools/n8n/omnidesk-webhook.json`.
12. **Enmienda: secreto generado.** Quitar `n8n_client_id` de la migración y del modelo; sustituir `PUT …/n8n-client` y `ConfigureN8nClientRequestSchema` por `POST …/n8n-client` y `N8nClientCredentialsResponseSchema`; `X-Client-Id` pasa a ser el id del canal; el paso "IA con n8n" pasa a Client ID en solo lectura, generar/regenerar con diálogo de una vez y quitar. Ajustar pruebas unitarias, e2e y docs.

## Criterios de aceptación

- [ ] Tras la migración, todos los canales tienen `ai_enabled = false` y `n8n_client_secret_enc` a `null`.
- [ ] `POST /api/v1/channels/:id/n8n-client` como OWNER responde `201 { clientId, clientSecret }`, con `clientId` igual al id del canal y `clientSecret` con forma `ncs_` + 43 caracteres base64url.
- [ ] Después, `GET /api/v1/channels` muestra `hasN8nClientSecret: true` y no incluye el secreto ni `hasCredentials`.
- [ ] La misma petición como AGENT responde `403`; con un canal de otra empresa, `404`.
- [ ] Regenerar devuelve un secreto distinto, y el siguiente `ping` lleva el nuevo.
- [ ] En la base, `n8n_client_secret_enc` no contiene el secreto en claro.
- [ ] `PATCH …/whatsapp { aiEnabled: true }` con webhook y sin secreto de cliente responde `400`. Con ambos responde `200`, aunque el canal no tenga secreto HMAC.
- [ ] `DELETE …/n8n-client` deja `hasN8nClientSecret: false` y `aiEnabled: false`; repetirlo responde `200`.
- [ ] La llamada `ai.reply` a n8n lleva `X-Client-Id: <channelId>`, `X-Client-Secret` e `Idempotency-Key`, y no lleva `X-OmniDesk-Signature`.
- [ ] El `ping` de "Probar conexión" lleva `X-Client-Id` y `X-Client-Secret`, sin firma. Sin secreto responde `ok: false` con el error "El canal no tiene credenciales de cliente de n8n" y no hace ninguna petición.
- [ ] Un `message.send` de un canal N8N sin secreto de cliente deja el mensaje `FAILED`. Con secreto lleva las dos cabeceras y no lleva firma.
- [ ] `POST /api/v1/channels/:id/credentials` responde `404`.
- [ ] `POST /api/v1/channels` con `provider: 'N8N'` responde `400`.
- [ ] Un canal N8N existente sigue aceptando `POST /api/v1/integrations/messages/outbound` con su API key y su firma HMAC.
- [ ] El panel de un canal WhatsApp Cloud muestra 2 pasos ("Conectar Meta", "IA con n8n") y el de un N8N muestra 1. Ninguno muestra "Credenciales de n8n".
- [ ] En "IA con n8n" se ve el Client ID (el id del canal) con Copiar; "Probar conexión" y el interruptor de IA están deshabilitados hasta guardar el webhook y generar el secreto.
- [ ] Generar muestra el secreto una sola vez en un diálogo; al cerrarlo ya no se puede ver. Regenerar pide confirmación.
- [ ] "Quitar client secret" pide confirmación y, tras confirmar, la IA aparece apagada.
- [ ] El workflow de `tools/n8n/omnidesk-webhook.json` responde `401` a una petición con un `X-Client-Secret` incorrecto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y los e2e de la API pasan.

## Decisiones

- **Sí (enmienda):** `clientId` = id del canal y `clientSecret` generado por OmniDesk. Son los valores que el usuario guarda y valida en n8n; nadie tiene que inventar ni teclear un secreto.
- **No (versión anterior):** par escrito por la empresa en dos campos. Se implementó y se cambió a petición del usuario el mismo día.
- **No:** `X-Client-Id: <channelId>` + secreto HMAC (el cambio en curso). Convierte un secreto de firma en una contraseña que viaja en claro.
- **No:** columna `n8n_client_id`. Con el id del canal como `clientId` sería redundante.
- **Sí:** el secreto se ve una sola vez, como las credenciales antiguas. Si se pierde, se regenera.
- **No:** consultar el secreto en cualquier momento. Dejaría el secreto expuesto a cualquier OWNER o ADMIN.
- **Sí:** regenerar invalida el anterior al instante. OmniDesk solo puede enviar uno; la gracia, si se quiere, la da n8n aceptando ambos.
- **Sí:** cabeceras `X-Client-Id` / `X-Client-Secret`. El nodo Webhook de n8n las valida con Header Auth y no cambian el cuerpo.
- **No:** campos en el cuerpo JSON. Cambian el contrato y quedan en el historial de ejecuciones de n8n.
- **No:** `Authorization: Basic`. Confirmado por el usuario a favor de cabeceras propias.
- **Sí:** las tres llamadas (`ai.reply`, `ping`, `message.send`). Es el mismo webhook; si `ping` no las llevara, "Probar conexión" fallaría contra un n8n que las exige.
- **Sí:** se sustituye la firma `X-OmniDesk-Signature`. Decisión del usuario. Se pierde la protección de integridad y contra repetición: depende de HTTPS (ya obligatorio en producción).
- **No:** mantener la firma como respaldo para canales sin credenciales. Dos caminos de código y una transición que no termina.
- **Sí:** la migración apaga la IA en todos los canales. Nunca se llama a n8n sin autenticación; el coste es que la IA queda apagada hasta reconfigurar.
- **Sí:** el secreto se genera en el paso "IA con n8n". Es donde ya está el webhook al que se manda.
- **Sí:** quitar el secreto apaga la IA, igual que el resto de requisitos de la IA.
- **Sí:** se elimina el paso "Credenciales de n8n" en todos los canales y el endpoint `POST …/credentials`. Decisión del usuario.
- **Sí:** como consecuencia, no se crean canales N8N nuevos y los existentes conservan su API key sin poder rotarla. Retirar N8N es otro spec.
- **Sí:** OWNER y ADMIN gestionan las credenciales, por `canManageChannels`. La petición decía "Owner"; se sigue la regla de canales existente.
- **Sí:** secreto `ncs_` + 32 bytes aleatorios, con prefijo propio como `odk_` y `whsec_`, para reconocerlo en un log o un gestor de secretos.
- **Sí:** se actualiza `tools/n8n/omnidesk-webhook.json`. Sin eso, el workflow de ejemplo rechazaría todas las peticiones al no recibir firma.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Al desplegar, la IA se apaga en todos los canales y los clientes pasan a atención humana. | Desplegar a la vez que se cambia el workflow de n8n. Avisar a las empresas antes. Reactivar es un solo paso por canal. |
| El secreto en claro queda en logs de n8n, de Caddy o de un proxy intermedio. | OmniDesk no registra cabeceras salientes. La documentación pide no registrar `X-Client-Secret` en n8n. HTTPS en producción. |
| Sin firma, quien capture una petición puede repetirla. | n8n deduplica por `Idempotency-Key` (SPEC 09). `controlVersion` descarta respuestas de IA tardías. |
| Un canal N8N existente pierde la API key y no puede generar otra. | Fuera de alcance a propósito. Si pasa, se inserta a mano o se aborda en el spec que retire N8N. |
| Regenerar el secreto en OmniDesk antes de actualizar n8n corta la IA. | La confirmación lo avisa. Las llamadas fallidas se reintentan por Outbox y luego quedan para atención humana. "Probar conexión" verifica el par. |
| Se cierra el diálogo sin copiar el secreto. | Se regenera; el anterior no estaba en n8n, así que no corta nada. |

## Qué **no** entra en este spec

- Retirar el proveedor N8N, sus endpoints de integración o el secreto HMAC.
- Rotar la API key de canales N8N existentes.
- Borrar `hmac_secret_*` o `integration_credentials`.
- Periodo de gracia con dos secretos de cliente.
- OAuth o tokens de corta vida hacia n8n.

Cada uno de esos, si llega, va en su propio spec.
