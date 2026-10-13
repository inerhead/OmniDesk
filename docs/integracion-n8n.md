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

1. En **Editar**, guarda la URL de un webhook de producción de n8n que devuelva la respuesta de IA dentro de la petición HTTP.
2. Pulsa **Generar credenciales**. Copia el secreto HMAC al entorno seguro de n8n. La API key se mantiene por compatibilidad con las integraciones antiguas; el flujo directo no necesita que n8n llame a OmniDesk.
3. Implementa `ping` y `ai.reply` en el workflow; usa **Probar conexión n8n** para verificar el ping.
4. Activa **Respuestas de IA**. No se permite activarla sin URL y HMAC.

Desactivar la IA afecta a las solicitudes pendientes y las respuestas en vuelo: se vuelve a comprobar la configuración antes de registrar la respuesta. Los mensajes entrantes siempre se guardan primero. Tomar/cerrar una conversación invalida respuestas con el `controlVersion` anterior.

Sin IA, o si n8n falla, el mensaje entrante permanece en la bandeja para atención humana. El fallo de IA se conserva en `outbox_events.last_error`; no se crea una respuesta falsa.

### Petición que recibe n8n

`POST <webhookUrl>` con `Content-Type: application/json`, `Idempotency-Key: <messageId>` y `X-OmniDesk-Signature`:

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

Responde `200 { "ok": true }`. La prueba muestra estado HTTP, latencia o error; no genera conversación ni llama al modelo.

El timeout de cada llamada es 10 segundos. IA y envíos usan Outbox y hasta cinco reintentos con esperas de 1/2/4/8/16 segundos. Devuelve de forma estable la misma respuesta para la misma `Idempotency-Key`; deduplica antes de invocar el modelo. No se siguen redirecciones.

## Firma HMAC de OmniDesk

Formato: `t=<unix_segundos>,v1=<hex HMAC_SHA256(secret, t + '.' + rawBody)>`.

El código siguiente puede adaptarse a un nodo Code de n8n con `node:crypto` habilitado. `rawBody` debe contener el cuerpo original capturado por el nodo Webhook (opción de cuerpo crudo); no uses `JSON.stringify()` sobre un objeto ya parseado para verificar una firma. La forma de obtener esos bytes depende de cómo configures el nodo.

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

function verifyOmniDesk(header, rawBody, secrets, nowSec = Math.floor(Date.now() / 1000)) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
  if (!match || Math.abs(nowSec - Number(match[1])) > 300) return false;
  const received = Buffer.from(match[2], 'hex');
  return secrets.some((secret) => {
    const expected = createHmac('sha256', secret)
      .update(match[1] + '.').update(rawBody).digest();
    return timingSafeEqual(expected, received);
  });
}

function signOmniDesk(secret, rawBody, nowSec = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret)
    .update(String(nowSec) + '.').update(rawBody).digest('hex');
  return `t=${nowSec},v1=${digest}`;
}
```

Obtén el secreto de almacenamiento seguro del servidor n8n. Nunca lo incluyas en respuestas del workflow. Rechaza firmas inválidas antes de ejecutar IA. Mantén sincronizado el reloj del servidor.

**Rotación:** la API key y el HMAC nuevos solo se muestran en el diálogo actual. OmniDesk acepta los anteriores durante 24 horas en las integraciones legadas. Al rotar, OmniDesk firma inmediatamente con el nuevo HMAC: n8n debe actualizarse para aceptarlo. El app secret y access token de Meta se sustituyen por separado y no tienen esa ventana de gracia local.

## Canales N8N legados y simulador

El adaptador N8N anterior se conserva para los canales existentes. Su webhook recibe `type: 'message.send'`, `messageId`, `conversationId`, `channel: { id, externalId }`, `to` y `text`. Debe deduplicar por `Idempotency-Key`, enviar a Meta y devolver `2xx { "providerMessageId": "wamid.…" }`.

Esos canales y el simulador utilizan los endpoints con `Authorization: Bearer <apiKey>` y firma HMAC cuando el canal tiene secreto:

- `POST /api/v1/integrations/messages/inbound`: `{ externalMessageId, from: { externalId, displayName? }, text, sentAt }`; devuelve `conversationId`, `messageId`, `aiAllowed`, `controlVersion` y `duplicate`.
- `POST /api/v1/integrations/messages/outbound`: `{ conversationId, controlVersion, idempotencyKey, text }`; devuelve `messageId` y `sendAllowed`. Si el control cambió, no se envía.
- `POST /api/v1/integrations/messages/status`: `{ messageId, providerMessageId, status, occurredAt, error? }`; estados `SENT`, `DELIVERED`, `READ`, `FAILED`.

Los canales `WHATSAPP_CLOUD` usan exclusivamente el webhook nativo de Meta, no estos endpoints legados. Para un canal de prueba N8N, créalo con `POST /api/v1/channels` (sesión OWNER/ADMIN, Origin permitido) y genera credenciales desde Settings. Ejecuta:

```sh
DEMO_CHANNEL_API_KEY='<apiKey del canal de prueba>' \
SIMULATOR_HMAC_SECRET='<hmacSecret del canal>' \
SIMULATOR_API_URL='http://localhost:8088/omnidesk' \
pnpm simulate
```

El nombre histórico `DEMO_CHANNEL_API_KEY` es también la variable que lee el simulador para la credencial del canal de prueba. El demo `SIMULATED` sigue funcionando sin HMAC. El simulador prueba los contratos internos; no envía webhooks nativos de Meta.

## Operación y limitaciones

- `CHANNEL_SECRETS_KEY`: 32 bytes en base64, distinta por entorno. Respalda esta clave junto con el plan de recuperación; perderla impide descifrar los tokens y secretos guardados.
- `WHATSAPP_GRAPH_VERSION`: versión Graph del servidor, por defecto `v25.0`; ajústala a una versión soportada por tu aplicación Meta.
- `N8N_WEBHOOK_ALLOWED_HOSTS`: permite hosts internos de confianza, por ejemplo `n8n`, para HTTP. Fuera de la lista no se permiten IP literales privadas; en producción se exige HTTPS.
- Solo texto libre. No se gestionan plantillas, multimedia ni la ventana de atención de Meta. Un envío rechazado queda FAILED.
- Meta puede aceptar un envío y cortarse la conexión antes de que OmniDesk persista su id. Su API no ofrece aquí una garantía de envío exactamente una vez: un reintento puede duplicarlo. `biz_opaque_callback_data` correlaciona los estados con el id local, pero no es una clave de idempotencia.
- La prueba real requiere un número habilitado y credenciales válidas de Meta/n8n; las pruebas automatizadas usan Graph/n8n simulados y PostgreSQL aislado.
