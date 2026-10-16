# SPEC 22 — Credenciales de cliente en las llamadas a n8n

> **Status:** Approved
> **Depends on:** SPEC 09, SPEC 17
> **Date:** 2026-10-16
> **Objective:** Toda llamada de OmniDesk al webhook de n8n (`ai.reply`, `ping` y `message.send`) se autentica con un `clientId` y un `clientSecret` que configura el Owner en el paso "IA con n8n", sustituyen a la firma `X-OmniDesk-Signature` y reemplazan al paso "Credenciales de n8n", que desaparece.

## Por qué existe este spec

Sale de la petición del 2026-10-16: "al llamar la AI a n8n se envíe clientId y clientSecret".

Hoy OmniDesk firma cada llamada a n8n con el secreto HMAC del canal (`X-OmniDesk-Signature`). Ese secreto lo genera OmniDesk en el paso "3. Credenciales de n8n", junto a una API key. El workflow de n8n tiene que verificar la firma con un nodo Code y el cuerpo crudo.

El usuario quiere que n8n reciba un par `clientId` / `clientSecret` propio, elegido por la empresa, que n8n valide con su autenticación por cabecera. La firma deja de enviarse.

Hay un cambio sin commitear en `main` que manda `X-Client-Id: <channelId>` y `X-Client-Secret: <secreto HMAC>`. Este spec lo sustituye: el par es nuevo y el secreto HMAC no viaja en claro.

Lo que ya fijaron otros specs y aquí no se reabre:

- Cifrado de secretos de canal con `CHANNEL_SECRETS_KEY` y `ChannelSecretCipher` (SPEC 09).
- Contrato de `ai.reply`, `ping` y `message.send`, timeout de 10 s, `Idempotency-Key`, reintentos por Outbox y no seguir redirecciones (SPEC 09).
- Política de `webhookUrl` contra SSRF (SPEC 09).
- `canManageChannels`: OWNER y ADMIN gestionan canales (SPEC 07).
- Estructura de pasos del panel de canal (SPEC 17).
- Los endpoints de integración entrantes (n8n → OmniDesk) de los canales N8N: `Authorization: Bearer <apiKey>` y firma HMAC entrante (SPEC 09).

## Alcance

**Dentro:**

- **Datos del canal.** Dos columnas nuevas en `channels`:
  - `n8n_client_id`: texto en claro, se muestra en la UI.
  - `n8n_client_secret_enc`: cifrado con `ChannelSecretCipher`, nunca se devuelve.
- **Formato** (texto recortado):
  - `clientId`: de 1 a 200 caracteres.
  - `clientSecret`: de 16 a 512 caracteres.
- **Configurar (`PUT /api/v1/channels/:id/n8n-client { clientId, clientSecret? }`):**
  - Solo OWNER y ADMIN (`canManageChannels`); si no, `403`.
  - Si el canal no tiene secreto guardado, `clientSecret` es obligatorio; si falta, `400`.
  - Si ya tiene secreto, omitir `clientSecret` conserva el actual (secreto de solo escritura, como en `PATCH /:id/whatsapp`).
  - Responde `200` con el `Channel` actualizado.
- **Quitar (`DELETE /api/v1/channels/:id/n8n-client`):**
  - Solo OWNER y ADMIN.
  - En una transacción: pone las dos columnas a `null` y `ai_enabled = false`.
  - Responde `200` con el `Channel` actualizado. Repetirlo sin credenciales responde `200` sin cambios.
- **Cabeceras en las tres llamadas a n8n** (`ai.reply` en `AiReplyWorker`, `ping` en `HttpChannelWebhookTester` y `message.send` en `N8nMessagingProvider`):
  - `X-Client-Id: <clientId>` y `X-Client-Secret: <clientSecret descifrado>`.
  - Se mantienen `Content-Type: application/json` e `Idempotency-Key` donde ya estaban.
  - **No** se envía `X-OmniDesk-Signature`.
  - El cuerpo de cada llamada no cambia.
- **Sin credenciales de cliente:**
  - `ai.reply`: el worker no llama a n8n y no hace nada, como hoy sin webhook. El mensaje queda en Sin asignar.
  - `ping` (`POST /api/v1/channels/:id/test`): responde `ok: false`, `httpStatus: null` y `error: 'El canal no tiene credenciales de cliente de n8n'`, sin llamar.
  - `message.send` (canales N8N): lanza `ChannelNotConfiguredError` y el mensaje queda `FAILED`, como hoy sin `webhookUrl`.
- **Activar la IA** (`PATCH /api/v1/channels/:id/whatsapp { aiEnabled: true }`):
  - Exige `webhookUrl`, `n8n_client_id` y `n8n_client_secret_enc`. Ya no exige el secreto HMAC.
  - Si falta algo, `400` con el mensaje "Configura el webhook de IA y las credenciales de cliente antes de activarla".
- **Migración:**
  - Añade las dos columnas, nulas.
  - Pone `ai_enabled = false` en todos los canales, porque ninguno tiene aún credenciales de cliente.
  - Las columnas de HMAC y la tabla `integration_credentials` no se tocan.
- **Contrato (`packages/contracts/src/channels.ts`):**
  - `ChannelSchema`: añade `n8nClientId: string | null` y `hasN8nClientSecret: boolean`; quita `hasCredentials`.
  - Nuevo `ConfigureN8nClientRequestSchema`.
  - `CreateChannelRequestSchema`: `provider` solo admite `'WHATSAPP_CLOUD'`; se quitan `webhookUrl` y su `refine`.
  - Se elimina `ChannelCredentialsResponseSchema`.
- **Canales N8N:**
  - No se pueden crear nuevos: `POST /api/v1/channels` con `provider: 'N8N'` responde `400` por validación del contrato.
  - Los existentes siguen funcionando con su API key y su HMAC vigentes en los endpoints de integración entrantes.
  - Para enviar (`message.send`) necesitan credenciales de cliente, que se configuran en su paso "IA con n8n".
- **Endpoint eliminado:** `POST /api/v1/channels/:id/credentials` desaparece y responde `404`. Se borran `IssueChannelCredentialsUseCase`, `newChannelCredentials` y su ruta.
- **Web, paso "IA con n8n"** (`apps/web/src/features/channels/steps/ai-step.tsx`), en todos los proveedores:
  - Campo "Client ID" (visible, editable) y campo "Client secret" (`type="password"`, vacío; si hay uno guardado, placeholder "Configurado · escribe para reemplazarlo").
  - Botón "Guardar credenciales": llama a `PUT …/n8n-client`. Aviso "Credenciales de n8n guardadas.".
  - Botón "Quitar credenciales", con `ConfirmDialog` ("La IA se apagará en este canal"). Aviso "Credenciales de n8n quitadas.".
  - Botón "Probar conexión", movido desde el paso de credenciales, con la misma presentación del resultado. Deshabilitado sin `webhookUrl`, `n8nClientId` y `hasN8nClientSecret`.
  - El interruptor "Activar respuestas de IA" (WhatsApp Cloud) se habilita con webhook y ambas credenciales.
  - El texto de ayuda pasa a: "Sin IA, los mensajes llegan a la bandeja Sin asignar. Para activarla, guarda el webhook de n8n y sus credenciales de cliente."
  - El paso está completo con webhook, `n8nClientId`, `hasN8nClientSecret` y, en WhatsApp Cloud, la IA activa.
- **Web, paso "Credenciales de n8n":** se elimina en todos los canales.
  - Se borran `steps/credentials-step.tsx` e `issueCredentials` de `channels-api.ts`.
  - `channelSteps` deja de devolver la clave `'credentials'`. WhatsApp Cloud queda con 2 pasos y N8N con 1.
  - La insignia "n8n listo" pasa a significar webhook + `n8nClientId` + `hasN8nClientSecret`.
- **Firma saliente:** `postSignedJson` (`shared/infrastructure/http/signed-webhook.ts`) pasa a `postJson`, sin firma. `signPayload` se conserva porque lo usa el simulador.
- **Documentación y workflow:**
  - `docs/integracion-n8n.md`: la petición lleva `X-Client-Id` y `X-Client-Secret`; la firma HMAC saliente desaparece; el paso "Generar credenciales" se sustituye por "Credenciales de cliente"; la firma entrante y la API key quedan descritas solo para canales N8N existentes.
  - `tools/n8n/omnidesk-webhook.json`: el nodo "Verificar firma" pasa a "Verificar cliente". Compara `x-client-id` y `x-client-secret` con `timingSafeEqual` y responde `401` si no coinciden.

**Fuera de alcance (para futuros specs):**

- Retirar el proveedor N8N por completo, sus endpoints de integración y su secreto HMAC.
- Rotar o revocar la API key de un canal N8N existente.
- Borrar las columnas `hmac_secret_*` y la tabla `integration_credentials`.
- Periodo de gracia con dos secretos de cliente a la vez durante un cambio.
- OAuth o intercambio de token con n8n: el par viaja tal cual en cada llamada.
- Credenciales de cliente distintas por tipo de llamada.

## Modelo de datos

```prisma
model Channel {
  // …campos actuales sin cambios…
  /// Identificador que n8n espera en `X-Client-Id` (SPEC 22).
  n8nClientId        String? @map("n8n_client_id")
  /// AES-256-GCM: iv (12 B) || ciphertext || tag (16 B). Se envía en `X-Client-Secret` (SPEC 22).
  n8nClientSecretEnc Bytes?  @map("n8n_client_secret_enc")
}
```

Migración `apps/api/prisma/migrations/20261026000000_n8n_client_credentials/migration.sql`:

```sql
ALTER TABLE channels ADD COLUMN n8n_client_id text, ADD COLUMN n8n_client_secret_enc bytea;
UPDATE channels SET ai_enabled = false WHERE ai_enabled;
```

`channels` ya tiene `tenant_id` y política RLS: no hace falta una política nueva.

```ts
// packages/contracts/src/channels.ts
ChannelSchema = z.object({
  // …
  n8nClientId: z.string().nullable(),
  hasN8nClientSecret: z.boolean(),
  // hasCredentials: eliminado
});

/** `PUT /api/v1/channels/:id/n8n-client`: omitir clientSecret conserva el guardado. */
ConfigureN8nClientRequestSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(16).max(512).optional(),
});
```

Cabeceras de cada llamada a `webhookUrl`:

```http
POST <webhookUrl>
Content-Type: application/json
Idempotency-Key: <messageId>        # en ai.reply y message.send
X-Client-Id: <clientId>
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

## Criterios de aceptación

- [ ] Tras la migración, todos los canales tienen `ai_enabled = false` y las columnas nuevas a `null`.
- [ ] `PUT /api/v1/channels/:id/n8n-client` con `{ clientId: 'acme', clientSecret: '0123456789abcdef' }` como OWNER responde `200`, `n8nClientId: 'acme'` y `hasN8nClientSecret: true`.
- [ ] La misma petición como AGENT responde `403`.
- [ ] `PUT` sin `clientSecret` en un canal que no tiene secreto responde `400`.
- [ ] `PUT { clientId: 'otro' }` en un canal con secreto cambia el id y conserva el secreto: el siguiente `ping` lleva el secreto anterior.
- [ ] `clientSecret` de 15 caracteres o `clientId` de 201 caracteres responden `400`.
- [ ] `GET /api/v1/channels` nunca incluye el `clientSecret` ni `hasCredentials`.
- [ ] En la base, `n8n_client_secret_enc` no contiene el secreto en claro.
- [ ] `PATCH …/whatsapp { aiEnabled: true }` con webhook y sin credenciales de cliente responde `400`. Con ambas responde `200`, aunque el canal no tenga secreto HMAC.
- [ ] `DELETE …/n8n-client` deja `n8nClientId: null`, `hasN8nClientSecret: false` y `aiEnabled: false`.
- [ ] La llamada `ai.reply` a n8n lleva `X-Client-Id`, `X-Client-Secret` e `Idempotency-Key`, y no lleva `X-OmniDesk-Signature`.
- [ ] El `ping` de "Probar conexión" lleva `X-Client-Id` y `X-Client-Secret`, sin firma. Sin credenciales responde `ok: false` con el error "El canal no tiene credenciales de cliente de n8n" y no hace ninguna petición.
- [ ] Un `message.send` de un canal N8N sin credenciales de cliente deja el mensaje `FAILED`. Con credenciales lleva las dos cabeceras y no lleva firma.
- [ ] `POST /api/v1/channels/:id/credentials` responde `404`.
- [ ] `POST /api/v1/channels` con `provider: 'N8N'` responde `400`.
- [ ] Un canal N8N existente sigue aceptando `POST /api/v1/integrations/messages/outbound` con su API key y su firma HMAC.
- [ ] El panel de un canal WhatsApp Cloud muestra 2 pasos ("Conectar Meta", "IA con n8n") y el de un N8N muestra 1. Ninguno muestra "Credenciales de n8n".
- [ ] En "IA con n8n", "Probar conexión" y el interruptor de IA están deshabilitados hasta guardar el webhook, el Client ID y el Client secret.
- [ ] "Quitar credenciales" pide confirmación y, tras confirmar, la IA aparece apagada.
- [ ] El workflow de `tools/n8n/omnidesk-webhook.json` responde `401` a una petición con un `X-Client-Secret` incorrecto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y los e2e de la API pasan.

## Decisiones

- **Sí:** un par nuevo, escrito por la empresa. n8n (o el servicio que hay detrás) define qué credenciales acepta; OmniDesk solo las presenta.
- **No:** `X-Client-Id: <channelId>` + secreto HMAC (el cambio en curso). Convierte un secreto de firma en una contraseña que viaja en claro y no deja elegir los valores.
- **No:** que OmniDesk genere el par. Es lo que ya hacía el paso de credenciales, y el usuario lo quita.
- **Sí:** cabeceras `X-Client-Id` / `X-Client-Secret`. El nodo Webhook de n8n las valida con Header Auth y no cambian el cuerpo.
- **No:** campos en el cuerpo JSON. Cambian el contrato y quedan en el historial de ejecuciones de n8n.
- **No:** `Authorization: Basic`. Confirmado por el usuario a favor de cabeceras propias.
- **Sí:** las tres llamadas (`ai.reply`, `ping`, `message.send`). Es el mismo webhook; si `ping` no las llevara, "Probar conexión" fallaría contra un n8n que las exige.
- **Sí:** se sustituye la firma `X-OmniDesk-Signature`. Decisión del usuario. Se pierde la protección de integridad y contra repetición: depende de HTTPS (ya obligatorio en producción).
- **No:** mantener la firma como respaldo para canales sin credenciales. Dos caminos de código y una transición que no termina.
- **Sí:** la migración apaga la IA en todos los canales. Nunca se llama a n8n sin autenticación; el coste es que la IA queda apagada hasta reconfigurar.
- **Sí:** configuración en el paso "IA con n8n", con el secreto de solo escritura. Es donde ya está el webhook al que se mandan.
- **Sí:** quitar las credenciales apaga la IA, igual que el resto de requisitos de la IA.
- **Sí:** se elimina el paso "Credenciales de n8n" en todos los canales y el endpoint `POST …/credentials`. Decisión del usuario.
- **Sí:** como consecuencia, no se crean canales N8N nuevos y los existentes conservan su API key sin poder rotarla. Retirar N8N es otro spec.
- **Sí:** OWNER y ADMIN gestionan las credenciales, por `canManageChannels`. La petición decía "Owner"; se sigue la regla de canales existente.
- **Sí:** límites `clientId` 1–200 y `clientSecret` 16–512. Rechaza secretos triviales y caben claves de proveedores.
- **Sí:** se actualiza `tools/n8n/omnidesk-webhook.json`. Sin eso, el workflow de ejemplo rechazaría todas las peticiones al no recibir firma.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Al desplegar, la IA se apaga en todos los canales y los clientes pasan a atención humana. | Desplegar a la vez que se cambia el workflow de n8n. Avisar a las empresas antes. Reactivar es un solo paso por canal. |
| El secreto en claro queda en logs de n8n, de Caddy o de un proxy intermedio. | OmniDesk no registra cabeceras salientes. La documentación pide no registrar `X-Client-Secret` en n8n. HTTPS en producción. |
| Sin firma, quien capture una petición puede repetirla. | n8n deduplica por `Idempotency-Key` (SPEC 09). `controlVersion` descarta respuestas de IA tardías. |
| Un canal N8N existente pierde la API key y no puede generar otra. | Fuera de alcance a propósito. Si pasa, se inserta a mano o se aborda en el spec que retire N8N. |
| Cambiar el secreto en OmniDesk antes que en n8n corta la IA. | Las llamadas fallidas se reintentan por Outbox y luego quedan para atención humana. "Probar conexión" verifica el par antes de activar la IA. |

## Qué **no** entra en este spec

- Retirar el proveedor N8N, sus endpoints de integración o el secreto HMAC.
- Rotar la API key de canales N8N existentes.
- Borrar `hmac_secret_*` o `integration_credentials`.
- Periodo de gracia con dos secretos de cliente.
- OAuth o tokens de corta vida hacia n8n.

Cada uno de esos, si llega, va en su propio spec.
