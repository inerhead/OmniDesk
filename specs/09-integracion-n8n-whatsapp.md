# SPEC 09 — Integración real: canales, n8n/WhatsApp y firma HMAC

> **Status:** Approved
> **Depends on:** SPEC 05, SPEC 07, SPEC 08
> **Date:** 2026-10-12
> **Objective:** Un OWNER o ADMIN da de alta canales de WhatsApp en la UI, genera y rota su API key y su secreto HMAC, y prueba la conexión, y los mensajes de agente de esos canales salen por un adaptador `N8nMessagingProvider` que llama al webhook de n8n con firma HMAC, mientras OmniDesk verifica la firma de todo lo que n8n le envía.

## Por qué existe este spec

SPEC 05 dejó el envío detrás del puerto `MessagingProvider`, con un único adaptador simulado elegido por la variable global `MESSAGING_PROVIDER`. SPEC 08 dejó OmniDesk en un dominio público. Falta conectarlo a WhatsApp de verdad.

Según §4.1 de la arquitectura, n8n recibe el webhook de WhatsApp Cloud API, registra el mensaje en OmniDesk y ejecuta la IA. Para las respuestas de un agente, el camino inverso es: OmniDesk → webhook de n8n → WhatsApp Cloud API. n8n reporta los estados por `POST /integrations/messages/status`, que ya existe.

La firma HMAC (§11) se aplica en **ambas direcciones**. Así un tercero que conozca la URL no puede inyectar mensajes en OmniDesk ni hacer que n8n envíe mensajes en nombre de la empresa.

## Alcance

**Dentro:**

- **Proveedor por canal:** `Channel.provider` decide el adaptador.
  - `SIMULATED` → `SimulatedMessagingProvider`.
  - `N8N` → `N8nMessagingProvider`.
  - Desaparece la variable `MESSAGING_PROVIDER`. `SIMULATED_PROVIDER_FAILURE_RATE` se mantiene.
  - El canal demo pasa a `SIMULATED`.
- **`MessagingProviderRegistry`:** el dispatcher (SPEC 05) obtiene el adaptador según el canal del mensaje.
- **Adaptador `N8nMessagingProvider`:**
  - Hace `POST` al `webhookUrl` del canal con `{ type: 'message.send', messageId, conversationId, channel: { id, externalId }, to, text }`.
  - Cabeceras: firma `X-OmniDesk-Signature` e `Idempotency-Key: <messageId>`.
  - Timeout de 10 s.
  - Si responde `2xx` con `{ providerMessageId }`, el envío tiene éxito.
  - Cualquier otro resultado lanza un error, y se aplican los reintentos 1/2/4/8/16 s de SPEC 05.
- **Firma HMAC:**
  - Formato: `X-OmniDesk-Signature: t=<unix_segundos>,v1=<hex(HMAC_SHA256(secreto, t + "." + cuerpo_crudo))>`.
  - **Entrada** (n8n → OmniDesk: `inbound`, `outbound`, `status`):
    - Si el canal tiene secreto, la firma es obligatoria.
    - Se rechaza si `|ahora − t| > 300 s` o si `v1` no coincide (comparación en tiempo constante): `401 INVALID_SIGNATURE`.
    - Si el canal no tiene secreto (solo el canal demo `SIMULATED`), no se exige firma.
  - **Salida** (OmniDesk → n8n): siempre firmada con el secreto del canal. Un canal `N8N` sin secreto no puede enviar: el mensaje queda `FAILED` con `failureReason: 'CHANNEL_NOT_CONFIGURED'`.
  - Durante una rotación, la entrada acepta el secreto actual o el anterior mientras este siga vigente.
- **Secretos cifrados:**
  - El secreto HMAC se guarda cifrado con AES-256-GCM, usando `CHANNEL_SECRETS_KEY` (32 bytes en base64, distinta por entorno).
  - La API key sigue guardada solo como sha256 (SPEC 02).
- **Gestión de canales** (`/settings/channels`, OWNER y ADMIN):
  - `GET /api/v1/channels`: lista sin secretos. Indica si tiene credencial y secreto, y la fecha de la última rotación.
  - `POST /api/v1/channels`: `{ name, phoneNumber (E.164), externalId (phone_number_id de Meta), provider: 'N8N', webhookUrl }`.
  - `PATCH /api/v1/channels/:id`: nombre y `webhookUrl`.
  - `POST /api/v1/channels/:id/credentials`:
    - Genera una API key nueva y un secreto HMAC nuevo, y **los devuelve una sola vez**.
    - Si ya existían, los anteriores siguen válidos 24 h (`expiresAt`).
  - `POST /api/v1/channels/:id/test`:
    - Envía `{ type: 'ping', channelId, at }` firmado al webhook.
    - Devuelve `{ ok, httpStatus, latencyMs, error }` y no reintenta.
  - **UI:**
    - Lista de canales.
    - Formulario de alta y edición.
    - Diálogo "Credenciales generadas", con los dos valores, botón **Copiar** y el aviso "No volverás a verlos".
    - Botón **Rotar credenciales**, con confirmación.
    - Botón **Probar conexión**, con el resultado en línea.
- **Validación de `webhookUrl`:**
  - En producción, solo `https://`, salvo que el host esté en `N8N_WEBHOOK_ALLOWED_HOSTS`, que admite `http://` (por ejemplo, n8n en la misma red del VPS).
  - En desarrollo se admite `http://`.
  - Nunca se admiten IP literales privadas fuera de esa lista.
- **Simulador:** firma sus peticiones cuando existe `SIMULATOR_HMAC_SECRET`. Así se prueba la verificación de punta a punta en local.
- **Documento de contrato para n8n** (`docs/integracion-n8n.md`):
  - Endpoints, cuerpos y respuestas.
  - Cómo calcular y verificar la firma, con un fragmento para el nodo Code de n8n.
  - Idempotencia por `messageId`.
  - Qué estados reportar y cuándo.

**Fuera de alcance (para specs futuros):**

- Workflows de n8n exportados y versionados en el repo.
- Adaptador directo a WhatsApp Cloud API sin n8n (§4.2).
- Plantillas de WhatsApp, ventana de 24 h, multimedia y adjuntos.
- Otros canales (Instagram, Telegram, web chat).
- Borrar canales (solo se crean y se editan).
- Rate limiting por credencial (SPEC 10).

## Modelo de datos

**Prisma (cambios):**

```prisma
enum ChannelProvider {
  SIMULATED                 // nuevo; el canal demo migra aquí
  N8N
  CUSTOM                    // se conserva, sin adaptador todavía
}

model Channel {
  // … campos de SPEC 02
  /// Número público en E.164, para mostrar.
  phoneNumber          String?   @map("phone_number")
  webhookUrl           String?   @map("webhook_url")
  /// AES-256-GCM: iv (12 B) || ciphertext || tag (16 B).
  hmacSecretEnc        Bytes?    @map("hmac_secret_enc")
  hmacSecretPrevEnc    Bytes?    @map("hmac_secret_prev_enc")
  hmacSecretPrevUntil  DateTime? @map("hmac_secret_prev_until") @db.Timestamptz(3)
  credentialsRotatedAt DateTime? @map("credentials_rotated_at") @db.Timestamptz(3)
  updatedAt            DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(3)
}

model IntegrationCredential {
  // … campos de SPEC 02
  /// Fin de la vigencia tras una rotación; null = vigente indefinidamente.
  expiresAt DateTime? @map("expires_at") @db.Timestamptz(3)
}
```

`ChannelCredentialGuard` acepta una credencial si `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`.

**Contratos** (`packages/contracts/src/channels.ts`, `integrations.ts`):

```ts
ChannelSchema = {
  id, name, type: 'WHATSAPP', provider: z.enum(['SIMULATED', 'N8N', 'CUSTOM']),
  phoneNumber: E164Schema.nullable(), externalId: z.string(), webhookUrl: z.url().nullable(),
  hasCredentials: z.boolean(), credentialsRotatedAt: z.iso.datetime().nullable(),
}
CreateChannelRequestSchema = { name, phoneNumber: E164Schema, externalId: z.string().min(1).max(64),
                               provider: z.literal('N8N'), webhookUrl: z.url() }
UpdateChannelRequestSchema = { name?, webhookUrl? }
ChannelCredentialsResponseSchema = { apiKey: z.string(), hmacSecret: z.string(),
                                     previousValidUntil: z.iso.datetime().nullable() }
ChannelTestResponseSchema = { ok: z.boolean(), httpStatus: z.int().nullable(),
                              latencyMs: z.int(), error: z.string().nullable() }

// Petición saliente a n8n (documentada; n8n la consume)
N8nSendMessageRequestSchema = { type: z.literal('message.send'), messageId: z.uuid(),
  conversationId: z.uuid(), channel: { id: z.uuid(), externalId: z.string() },
  to: E164Schema, text: MessageTextSchema }
N8nSendMessageResponseSchema = { providerMessageId: z.string().min(1).max(200) }
```

**Variables de entorno:**

```
CHANNEL_SECRETS_KEY=               # 32 bytes en base64; obligatoria con NODE_ENV=production
N8N_WEBHOOK_ALLOWED_HOSTS=         # lista separada por comas; p. ej. "n8n,n8n.gastromesa.com"
SIMULATOR_HMAC_SECRET=             # solo host/simulador
# Se elimina: MESSAGING_PROVIDER
```

**Funciones puras** (`shared/infrastructure/crypto/`), con pruebas:

```ts
signPayload(secret: string, rawBody: string, nowSec: number): string        // "t=…,v1=…"
verifySignature(header: string | undefined, rawBody: string,
                secrets: string[], nowSec: number, toleranceSec = 300):
  'ok' | 'missing' | 'malformed' | 'expired' | 'mismatch'
encryptSecret(plain: string, key: Buffer): Buffer
decryptSecret(blob: Buffer, key: Buffer): string
```

## Plan de implementación

1. **Cripto.** `signPayload`, `verifySignature`, `encryptSecret` y `decryptSecret`, con pruebas: vector conocido, tolerancia de ±300 s, secreto anterior y blob alterado.
2. **Modelo y migración** `…_channels_real`:
   - Valor `SIMULATED` en el enum.
   - Columnas nuevas en `channels` e `integration_credentials`.
   - El canal demo pasa a `SIMULATED`.
   - `CHANNEL_SECRETS_KEY` en `env.ts`, con un valor de desarrollo en `.env.example`.
3. **Cuerpo crudo y verificación de entrada.**
   - `NestFactory.create(..., { rawBody: true })`.
   - `ChannelCredentialGuard` verifica la firma cuando el canal tiene secreto.
   - e2e: sin firma, firma caducada, firma correcta y secreto anterior durante la rotación.
4. **Registro de proveedores.**
   - `MessagingProviderRegistry` en el módulo `messaging`, con el dispatcher resolviendo por el canal.
   - Eliminar `MESSAGING_PROVIDER`.
   - Siguen pasando las pruebas de SPEC 05.
5. **Adaptador n8n.**
   - `N8nMessagingProvider` con `fetch`, `AbortSignal.timeout(10_000)`, firma e `Idempotency-Key`.
   - Pruebas con un servidor HTTP falso: `2xx`, `5xx`, timeout y respuesta sin `providerMessageId`.
   - Caso `CHANNEL_NOT_CONFIGURED`.
6. **API de canales.**
   - Casos de uso `CreateChannel`, `UpdateChannel`, `IssueChannelCredentials` (con la rotación de 24 h) y `TestChannelConnection`.
   - Validación de `webhookUrl`.
   - Permisos OWNER/ADMIN.
   - e2e: un AGENT recibe `403`, los secretos nunca aparecen en `GET` y la rotación mantiene válidas las credenciales anteriores.
7. **Web: `/settings/channels`.**
   - Lista, formulario, diálogo de credenciales de un solo uso, rotar y probar conexión.
   - Entrada "Canales" en el menú de usuario (OWNER/ADMIN).
8. **Simulador.** Firma con `SIMULATOR_HMAC_SECRET` si existe. README: cómo emitir credenciales para un canal de prueba y lanzar el simulador contra él.
9. **Documentación.**
   - `docs/integracion-n8n.md`.
   - `docs/arquitectura.md` §11, §13 y §14.
   - README: sección "Conectar n8n".

## Criterios de aceptación

**Canales y credenciales**

- [ ] Como OWNER, crear un canal `N8N` con un número E.164 y `webhookUrl https://…` lo muestra en `/settings/channels` sin credenciales.
- [ ] "Generar credenciales" muestra la API key y el secreto una sola vez. Al cerrar el diálogo y recargar, no se pueden volver a ver.
- [ ] En la base, `integration_credentials.key_hash` es un sha256, y `channels.hmac_secret_enc` no contiene el secreto en claro.
- [ ] Tras **Rotar**, la API key y el secreto anteriores siguen siendo aceptados hasta 24 h después, y luego responden `401`.
- [ ] Un AGENT que llama a `GET /channels` recibe `403`, y no ve "Canales" en el menú.
- [ ] En producción, `webhookUrl http://10.0.0.5/hook` responde `400`. `http://n8n:5678/webhook/x` se acepta si `n8n` está en `N8N_WEBHOOK_ALLOWED_HOSTS`.
- [ ] **Probar conexión** contra un webhook que responde `200` muestra "Conexión correcta · N ms". Contra uno caído, muestra el error.

**Firma de entrada**

- [ ] `POST /integrations/messages/inbound` con credencial válida y sin firma, en un canal con secreto, responde `401 INVALID_SIGNATURE`.
- [ ] Con una firma de hace 6 min, responde `401`. Con la firma correcta, responde `201`.
- [ ] Alterar un byte del cuerpo después de firmarlo da `401`.
- [ ] El canal demo `SIMULATED` sigue aceptando `pnpm simulate` sin firma. Con `SIMULATOR_HMAC_SECRET` sobre un canal con secreto, el simulador funciona firmado.

**Envío por n8n**

- [ ] En un canal `N8N`, un mensaje de agente produce un `POST` al webhook con `X-OmniDesk-Signature` válida (verificable con el fragmento de `docs/integracion-n8n.md`) e `Idempotency-Key` igual al `messageId`.
- [ ] Si el webhook responde `200 { providerMessageId }`, el mensaje pasa a `SENT` con ese `externalId`.
- [ ] Si el webhook responde `500` cinco veces, el mensaje queda `FAILED`. **Reintentar** vuelve a llamar al webhook.
- [ ] Un canal `N8N` sin secreto deja el mensaje `FAILED` con `failureReason: CHANNEL_NOT_CONFIGURED`, sin llamar al webhook.
- [ ] Un reporte `DELIVERED` firmado por `/status` actualiza el tick en la web en ≤ 1 s.
- [ ] Con un número real y n8n configurado en dev, un mensaje enviado desde la PWA llega al WhatsApp del cliente.

**Calidad**

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` terminan con código 0, y el e2e del API pasa.

## Decisiones

- **Sí:** OmniDesk → webhook de n8n → WhatsApp Cloud API. Lo decidió el equipo; respeta §4.1, y n8n ya tiene el token de Meta.
- **No:** llamar directamente a WhatsApp Cloud API. Es §4.2 (flujo futuro) y duplicaría la gestión del token de Meta.
- **Sí:** HMAC en ambas direcciones, con timestamp y tolerancia de 300 s. Lo decidió el equipo. Impide inyectar mensajes y usar el webhook de n8n como relé abierto, y el timestamp limita los replays.
- **Sí:** proveedor por canal (`Channel.provider`). Lo decidió el equipo y lo anticipaban §13 y §17. Desaparece la variable global.
- **Sí:** secreto HMAC cifrado con AES-256-GCM y una clave por entorno. Lo decidió el equipo. Un dump o backup filtrado no permite firmar.
- **Sí:** API key y secreto visibles una sola vez, con rotación que deja los anteriores válidos 24 h. Permite actualizar n8n sin cortar el servicio.
- **Sí:** validación de `webhookUrl` con lista de hosts permitidos. n8n puede vivir en la red del VPS (`http://n8n:5678`) sin abrir SSRF hacia IP privadas arbitrarias.
- **Sí:** `Idempotency-Key = messageId` hacia n8n. Cierra el riesgo anotado en SPEC 05 (envío doble si el proceso cae entre `send` y `SENT`).
- **No:** versionar workflows de n8n en este spec. Lo decidió el equipo; el contrato queda documentado en `docs/integracion-n8n.md`.
- **No:** borrar canales. Tienen conversaciones e historial asociados; se decidirá con la política de retención (SPEC 12).

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Perder `CHANNEL_SECRETS_KEY` deja los secretos ilegibles | Se documenta en `docs/despliegue.md`, junto a los backups. La recuperación es rotar credenciales desde la UI y actualizar n8n. |
| Desfase de reloj entre n8n y OmniDesk > 300 s | NTP en el VPS (paso de la guía). El error `expired` se registra con la diferencia en segundos. |
| n8n reintenta y envía dos veces al cliente | `Idempotency-Key` documentado como obligatorio en el workflow, y n8n deduplica por `messageId`. |
| El cuerpo crudo no coincide con el firmado por reserialización | La verificación usa `req.rawBody` (los bytes recibidos), nunca `JSON.stringify(body)`. Hay una prueba con espacios y orden de claves distintos. |
| Webhook lento bloquea el dispatcher | Timeout de 10 s por envío. El dispatcher procesa los eventos pendientes con `SKIP LOCKED` (SPEC 03), y un envío lento no bloquea los de otras conversaciones. |
| SSRF mediante `webhookUrl` | `https` obligatorio en producción, IP privadas bloqueadas y excepciones solo por la lista explícita. Además, solo OWNER/ADMIN editan la URL. |

## Lo que **no** entra en este spec

- Workflows de n8n versionados.
- WhatsApp Cloud API directo.
- Plantillas, ventana de 24 h y multimedia.
- Otros canales.
- Borrado de canales.
- Rate limiting (SPEC 10).

Cada uno llega en su propio spec.
