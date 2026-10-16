# Conectar WhatsApp Cloud e IA opcional

## Configuración desde la web

En el menú de usuario, **Canales** (`/settings/channels`) está disponible para OWNER y ADMIN de la empresa activa.

1. Añade un canal con nombre, número E.164 y el **phone_number_id** de Meta.
2. Guarda el **access token** con permiso `whatsapp_business_messaging`, el **app secret** de la aplicación Meta y un **verify token** propio de al menos 24 caracteres. Conserva el verify token para el siguiente paso. Los valores guardados no se vuelven a mostrar.
3. Copia el **Webhook de WhatsApp** que muestra Settings. Su forma es `https://tu-dominio/omnidesk/api/v1/integrations/whatsapp/<channelId>`; se construye con `APP_URL`, incluida la subruta pública. El servidor debe ser accesible por Meta mediante HTTPS.
4. En la configuración de WhatsApp Cloud de tu aplicación Meta, registra esa URL de callback y el mismo verify token. Suscribe los eventos de mensajes del número correspondiente. Si varios números comparten una aplicación, configura la suscripción/callback que corresponda en Meta: la ruta de OmniDesk solo procesa el `phone_number_id` de su canal.
5. Envía un mensaje de texto desde un teléfono de prueba autorizado. Debe aparecer en **Sin asignar**. Un agente puede tomarlo y responder aunque no exista integración de IA.

El GET de verificación devuelve `hub.challenge` como texto solo si `hub.mode=subscribe` y `hub.verify_token` coincide. Los POST requieren `X-Hub-Signature-256: sha256=<HMAC_SHA256(appSecret, rawBody)>`. El verify token y el app secret tienen funciones distintas.

Referencias de Meta: [verificación del webhook](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/), [envío de texto](https://www.postman.com/meta/whatsapp-business-platform/request/8gvd47s/send-text-message).

## Activar IA

Todo se configura en el paso **IA con n8n** del canal.

1. Guarda la URL de un webhook de producción de n8n que devuelva la respuesta de IA dentro de la petición HTTP.
2. Escribe el **Client ID** y el **Client secret** que tu workflow de n8n espera y pulsa **Guardar credenciales** (ver [Credenciales de cliente](#credenciales-de-cliente)). El secreto no se vuelve a mostrar; deja el campo vacío para conservarlo al cambiar solo el Client ID.
3. Implementa `ping` y `ai.reply` en el workflow; usa **Probar conexión** para verificar el ping.
4. Activa **Respuestas de IA**. No se permite activarla sin URL y credenciales de cliente.

**Quitar credenciales** borra el Client ID y el secreto y apaga la IA del canal.

Desactivar la IA afecta a las solicitudes pendientes y las respuestas en vuelo: se vuelve a comprobar la configuración antes de registrar la respuesta. Los mensajes entrantes siempre se guardan primero. Tomar/cerrar una conversación invalida respuestas con el `controlVersion` anterior.

Sin IA, o si n8n falla, el mensaje entrante permanece en la bandeja para atención humana. El fallo de IA se conserva en `outbox_events.last_error`; no se crea una respuesta falsa.

### Petición que recibe n8n

`POST <webhookUrl>` con `Content-Type: application/json`, `Idempotency-Key: <messageId>`, `X-Client-Id` y `X-Client-Secret`:

```json
{
  "type": "ai.reply",
  "messageId": "0199c0de-0000-7000-8000-000000000001",
  "conversationId": "0199c0de-0000-7000-8000-000000000002",
  "controlVersion": 0,
  "channel": { "id": "0199c0de-0000-7000-8000-000000000003", "externalId": "123456789" },
  "from": { "externalId": "+573001234567", "displayName": "Ana" },
  "text": "Hola, ¿qué horarios tienen?"
}
```

n8n responde HTTP `2xx`, JSON:

```json
{ "text": "Hola Ana. Abrimos de lunes a viernes de 8 a 18." }
```

`text` debe cumplir `MessageTextSchema` de `@omnidesk/contracts`. No devuelvas una lista de items de n8n ni un objeto anidado. Configura el nodo de respuesta para devolver este objeto directamente. OmniDesk registra el mensaje de IA y lo envía a Meta; **n8n no lo envía a WhatsApp**.

La petición incluye el mensaje actual y los identificadores para que tu workflow gestione contexto si lo necesita. No incluye tokens de Meta ni todo el historial de conversación.

### Ping y límites

```json
{ "type": "ping", "channelId": "0199c0de-0000-7000-8000-000000000003", "at": "2026-10-12T10:00:00.000Z" }
```

Lleva `X-Client-Id` y `X-Client-Secret`, como `ai.reply`. Responde `200 { "ok": true }`. La prueba muestra estado HTTP, latencia o error; no genera conversación ni llama al modelo. Sin credenciales de cliente, OmniDesk no llama y muestra "El canal no tiene credenciales de cliente de n8n".

El timeout de cada llamada es 10 segundos. IA y envíos usan Outbox y hasta cinco reintentos con esperas de 1/2/4/8/16 segundos. Devuelve de forma estable la misma respuesta para la misma `Idempotency-Key`; deduplica antes de invocar el modelo. No se siguen redirecciones.

## Credenciales de cliente

Desde SPEC 22, OmniDesk se autentica ante n8n con dos cabeceras en **todas** sus llamadas (`ai.reply`, `ping` y `message.send`):

```http
X-Client-Id: <clientId>
X-Client-Secret: <clientSecret>
```

- Los valores los elige la empresa y los escribe en OmniDesk: `clientId` de 1 a 200 caracteres y `clientSecret` de 16 a 512.
- OmniDesk guarda el secreto cifrado con `CHANNEL_SECRETS_KEY` y nunca lo devuelve por la API.
- Las llamadas salientes ya **no** llevan `X-OmniDesk-Signature`. La protección depende de HTTPS (obligatorio en producción) y de deduplicar por `Idempotency-Key`.
- En n8n, valida las cabeceras antes de ejecutar la IA, por ejemplo con **Header Auth** en el nodo Webhook o buscando el par en una tabla, y responde `401` si no coinciden. Compara el secreto en tiempo constante (`crypto.timingSafeEqual`) si lo haces en un nodo Code.
- No registres `X-Client-Secret` en logs ni lo devuelvas en respuestas del workflow.
- Para cambiar el secreto, actualízalo primero en n8n (aceptando ambos un momento si tu workflow lo permite) y después en OmniDesk. No hay periodo de gracia: con el secreto antiguo en n8n, las llamadas fallan y quedan para atención humana tras los reintentos.

`tools/n8n/omnidesk-webhook.json` es un workflow de ejemplo que valida el par contra la tabla de datos `omnidesk_clients` y responde `401` si no existe.

## Canales N8N legados y simulador

El adaptador N8N anterior se conserva para los canales existentes; desde SPEC 22 **no se crean canales N8N nuevos** (`POST /api/v1/channels` solo admite `WHATSAPP_CLOUD`). Su webhook recibe `type: 'message.send'`, `messageId`, `conversationId`, `channel: { id, externalId }`, `to` y `text`, con `Idempotency-Key`, `X-Client-Id` y `X-Client-Secret`. Debe deduplicar por `Idempotency-Key`, enviar a Meta y devolver `2xx { "providerMessageId": "wamid.…" }`. Sin credenciales de cliente, el mensaje queda `FAILED` con `CHANNEL_NOT_CONFIGURED`.

En sentido contrario (n8n → OmniDesk), esos canales y el simulador siguen usando su API key y su secreto HMAC vigentes: `Authorization: Bearer <apiKey>` y `X-OmniDesk-Signature` cuando el canal tiene secreto. Desde SPEC 22 la API ya no emite ni rota esas credenciales (`POST /api/v1/channels/:id/credentials` responde `404`); si ya se rotaron, las anteriores siguen valiendo hasta su vencimiento de 24 horas:

- `POST /api/v1/integrations/messages/inbound`: `{ externalMessageId, from: { externalId, displayName? }, text, sentAt }`; devuelve `conversationId`, `messageId`, `aiAllowed`, `controlVersion` y `duplicate`.
- `POST /api/v1/integrations/messages/outbound`: `{ conversationId, controlVersion, idempotencyKey, text }`; devuelve `messageId` y `sendAllowed`. Si el control cambió, la conversación está cerrada o pasaron 18 h desde el último mensaje del cliente, responde `409` con `{ sendAllowed: false, reason }` (`CONTROL_CHANGED`, `CONVERSATION_CLOSED` o `WINDOW_CLOSED`) y no se envía.
- `POST /api/v1/integrations/messages/status`: `{ messageId, providerMessageId, status, occurredAt, error? }`; estados `SENT`, `DELIVERED`, `READ`, `FAILED`.

Formato de `X-OmniDesk-Signature` en esas peticiones: `t=<unix_segundos>,v1=<hex HMAC_SHA256(secret, t + '.' + rawBody)>`, con un desfase máximo de 5 minutos. Firma los bytes exactos que envías:

```js
const { createHmac } = require('node:crypto');

function signOmniDesk(secret, rawBody, nowSec = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret)
    .update(String(nowSec) + '.').update(rawBody).digest('hex');
  return `t=${nowSec},v1=${digest}`;
}
```

Los canales `WHATSAPP_CLOUD` usan exclusivamente el webhook nativo de Meta, no estos endpoints legados. Para el simulador contra un canal N8N existente, usa su API key y su secreto HMAC:

```sh
DEMO_CHANNEL_API_KEY='<apiKey del canal N8N>' \
SIMULATOR_HMAC_SECRET='<hmacSecret del canal>' \
SIMULATOR_API_URL='http://localhost:8088/omnidesk' \
pnpm simulate
```

El nombre histórico `DEMO_CHANNEL_API_KEY` es también la variable que lee el simulador para la credencial del canal de prueba. El demo `SIMULATED` sigue funcionando sin HMAC. El simulador prueba los contratos internos; no envía webhooks nativos de Meta.

## Operación y limitaciones

- `CHANNEL_SECRETS_KEY`: 32 bytes en base64, distinta por entorno. Respalda esta clave junto con el plan de recuperación; perderla impide descifrar los tokens y secretos guardados.
- `WHATSAPP_GRAPH_VERSION`: versión Graph del servidor, por defecto `v25.0`; ajústala a una versión soportada por tu aplicación Meta.
- `N8N_WEBHOOK_ALLOWED_HOSTS`: permite hosts internos de confianza, por ejemplo `n8n`, para HTTP. Fuera de la lista no se permiten IP literales privadas; en producción se exige HTTPS.
- Solo texto libre hacia la IA: los mensajes con adjunto (SPEC 14) o de tipos no soportados no se envían a n8n y quedan para atención humana. No se gestionan plantillas. Pasadas 18 h desde el último mensaje del cliente, `POST /integrations/messages/outbound` responde `409 { sendAllowed: false, reason: 'WINDOW_CLOSED' }` y la IA no debe enviar (SPEC 14). Un envío rechazado por el proveedor queda FAILED.
- Meta puede aceptar un envío y cortarse la conexión antes de que OmniDesk persista su id. Su API no ofrece aquí una garantía de envío exactamente una vez: un reintento puede duplicarlo. `biz_opaque_callback_data` correlaciona los estados con el id local, pero no es una clave de idempotencia.
- La prueba real requiere un número habilitado y credenciales válidas de Meta/n8n; las pruebas automatizadas usan Graph/n8n simulados y PostgreSQL aislado.
