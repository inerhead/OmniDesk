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
2. Copia el **Client ID** (es el id del canal) y pulsa **Generar client secret**. Copia el secreto del diálogo y guarda ambos en n8n (ver [Credenciales de cliente](#credenciales-de-cliente)). El secreto no se vuelve a mostrar; si lo pierdes, regéneralo.
3. Implementa `ping` y `ai.reply` en el workflow; usa **Probar conexión** para verificar el ping.
4. Activa **Respuestas de IA**. No se permite activarla sin URL y client secret.

**Quitar client secret** borra el secreto y apaga la IA del canal.

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
  "text": "¿y a qué hora llega?",
  "history": [
    { "role": "customer", "text": "Quiero dos hamburguesas", "at": "2026-10-16T18:00:00.000Z" },
    { "role": "ai", "text": "¡Claro! ¿Para domicilio o para recoger?", "at": "2026-10-16T18:00:04.000Z" },
    { "role": "agent", "agentName": "Laura", "text": "Tu pedido sale en 10 minutos.", "at": "2026-10-16T18:05:00.000Z" },
    { "role": "customer", "text": "", "attachment": "IMAGE", "at": "2026-10-16T18:06:00.000Z" }
  ]
}
```

Desde SPEC 24, `history` trae los **20 mensajes anteriores** al actual (`AI_REPLY_HISTORY_LIMIT`), en orden cronológico. Esquema: `N8nAiReplyRequestSchema` de `@omnidesk/contracts`.

- No incluye el mensaje actual: ese va en `text`.
- `role`: `customer`, `ai` o `agent`. `agentName` (el nombre visible del miembro) solo aparece en `agent`.
- Incluye lo que escribieron los agentes humanos y los mensajes que llegaron mientras un agente tenía la conversación.
- No incluye los salientes `FAILED`: el cliente nunca los vio.
- Un adjunto aparece como `attachment` con su tipo (`IMAGE`, `DOCUMENT`, `AUDIO`, `VIDEO`, `STICKER`) y el pie en `text`. El archivo no se envía.
- La primera vez que escribe un cliente, `history` es `[]`.
- OmniDesk lo lee al llamar, no al encolar: un reintento trae los mensajes que hayan llegado entretanto.

n8n responde HTTP `2xx`, JSON:

```json
{ "text": "Hola Ana. Abrimos de lunes a viernes de 8 a 18." }
```

`text` debe cumplir `MessageTextSchema` de `@omnidesk/contracts`. No devuelvas una lista de items de n8n ni un objeto anidado. Configura el nodo de respuesta para devolver este objeto directamente. OmniDesk registra el mensaje de IA y lo envía a Meta; **n8n no lo envía a WhatsApp**.

Con `history`, el agente de n8n **no necesita memoria propia**: OmniDesk ya le da el contexto, incluido lo que dijeron los agentes humanos, y los mensajes de los clientes no se copian en n8n fuera de la retención de OmniDesk. La petición no incluye tokens de Meta.

### Ping y límites

```json
{ "type": "ping", "channelId": "0199c0de-0000-7000-8000-000000000003", "at": "2026-10-12T10:00:00.000Z" }
```

Lleva `X-Client-Id` y `X-Client-Secret`, como `ai.reply`. Responde `200 { "ok": true }`. La prueba muestra estado HTTP, latencia o error; no genera conversación ni llama al modelo. Sin client secret, OmniDesk no llama y muestra "El canal no tiene credenciales de cliente de n8n".

El timeout de cada llamada es 10 segundos. IA y envíos usan Outbox y hasta cinco reintentos con esperas de 1/2/4/8/16 segundos. Devuelve de forma estable la misma respuesta para la misma `Idempotency-Key`; deduplica antes de invocar el modelo. No se siguen redirecciones.

Desde SPEC 23, `ai.reply` solo se reintenta ante errores transitorios:

- **Se reintenta:** HTTP `408`, `429`, `500`, `502`, `503` y `504`, errores de red, timeout y redirecciones.
- **No se reintenta:** cualquier otro HTTP no `2xx` (`400`, `401`, `403`, `404`, `501`, `505`…) y una respuesta `2xx` que no es JSON o no trae un `text` válido.

En ambos casos el mensaje queda para atención humana y el motivo en `outbox_events.last_error` (`IA HTTP <status>` o `IA respuesta inválida`). Si tu workflow aún no implementa `ai.reply`, responde `501`: OmniDesk lo llama una sola vez por mensaje. Si el modelo falla, deja que el workflow termine en error (n8n responde `500`) para que OmniDesk reintente. `message.send` sigue reintentando cualquier error.

## Credenciales de cliente

Desde SPEC 22, OmniDesk se autentica ante n8n con dos cabeceras en **todas** sus llamadas (`ai.reply`, `ping` y `message.send`):

```http
X-Client-Id: <channelId>
X-Client-Secret: <clientSecret>
```

- El `clientId` es siempre el id del canal.
- El `clientSecret` lo genera OmniDesk (`POST /api/v1/channels/:id/n8n-client`, OWNER o ADMIN): `ncs_` seguido de 32 bytes aleatorios en base64url. Solo aparece en esa respuesta; OmniDesk lo guarda cifrado con `CHANNEL_SECRETS_KEY`.
- Regenerarlo invalida el anterior al instante. `DELETE /api/v1/channels/:id/n8n-client` lo quita y apaga la IA.
- Las llamadas salientes ya **no** llevan `X-OmniDesk-Signature`. La protección depende de HTTPS (obligatorio en producción) y de deduplicar por `Idempotency-Key`.
- En n8n, valida las cabeceras antes de ejecutar la IA, por ejemplo con **Header Auth** en el nodo Webhook o buscando el par en una tabla, y responde `401` si no coinciden. Compara el secreto en tiempo constante (`crypto.timingSafeEqual`) si lo haces en un nodo Code.
- No registres `X-Client-Secret` en logs ni lo devuelvas en respuestas del workflow.
- Al regenerar, OmniDesk envía el secreto nuevo desde ese momento: actualízalo en n8n enseguida (o deja que n8n acepte ambos un momento). Mientras n8n tenga el antiguo, las llamadas fallan y quedan para atención humana tras los reintentos.

## Workflow de ejemplo

`tools/n8n/OmniDesk — entrada.json` es un workflow importable que implementa `ping` y `ai.reply`:

1. Valida `X-Client-Id` y `X-Client-Secret` contra la tabla de datos `Credentials` (columnas `clientId` y `clientSecret`). Si no coinciden, responde `401`.
2. Según `type`: `ping` responde `200 { "ok": true }`; un tipo desconocido, `400`.
3. `ai.reply` busca la `Idempotency-Key` en la tabla `omnidesk_ai_replies`. Si ya existe, devuelve el mismo `text` sin llamar al modelo.
4. Si no, un **AI Agent** con Anthropic (`claude-haiku-5-5`) y memoria de 10 mensajes por `conversationId` genera la respuesta. Se guarda en `omnidesk_ai_replies` y se devuelve `200 { "text": "…" }`.

Este ejemplo es anterior a `history` (SPEC 24) y conserva la memoria de n8n. Para un negocio real usa el [workflow de Gastromesa](#workflow-de-gastromesa), que no tiene memoria.

Para importarlo:

1. En n8n, crea la tabla de datos `omnidesk_ai_replies` con dos columnas de texto: `idempotencyKey` y `text`.
2. Importa el fichero (**Import from File**).
3. En **Buscar cliente**, comprueba que apunta a tu tabla de credenciales.
4. En **Buscar respuesta previa** y **Guardar respuesta**, selecciona `omnidesk_ai_replies`.
5. En **Anthropic**, elige tu credencial de Anthropic.
6. Ajusta el prompt de sistema del nodo **Agente IA** a tu negocio.
7. Activa el workflow y usa **Probar conexión** en OmniDesk.

La memoria del agente vive en el proceso de n8n: se pierde al reiniciarlo y no se comparte entre workers en modo cola.

## Workflow de Gastromesa

`tools/n8n/OmniDesk — entrada Gastromesa.json` (en n8n, "OmniDesk — entrada Gastromesa") atiende a restaurantes que usan Gastromesa. Comparte con el ejemplo la validación de credenciales, `ping`, el `400` y la deduplicación con `omnidesk_ai_replies`. Cambia la generación de la respuesta:

1. **Buscar prompt** lee la fila del canal (`X-Client-Id`) en `omnidesk_prompts`. Si no existe, responde `501`: OmniDesk no reintenta y el mensaje queda para atención humana.
2. **Buscar endpoint menú** lee la fila `menu` del canal en `omnidesk_endpoints`.
3. **Preparar conversación** arma la entrada del agente con el nombre del cliente, `history` y el mensaje actual:

   ```text
   Nombre del cliente en WhatsApp: Gossio

   Conversación hasta ahora:
   Cliente: Quiero dos hamburguesas
   Asistente: ¡Claro! ¿Para domicilio o para recoger?
   Agente (Laura): Tu pedido sale en 10 minutos.
   Cliente: [imagen]

   Mensaje actual del cliente:
   ¿y a qué hora llega?
   ```

4. **Agente IA** responde con OpenAI (`gpt-5-mini`), el `systemPrompt` del canal y **sin memoria**.
5. El tool **consultar_menu** llama a Gastromesa (`baseUrl` + `ruta`, método `metodo`, cabecera `X-Client-Secret`) cuando el agente necesita productos, precios o disponibilidad. Si falla o el canal no tiene fila `menu`, el agente recibe el error, dice que no tiene el dato y ofrece un agente humano. El workflow responde `200`.
6. **Guardar respuesta** y **Responder IA**, como en el ejemplo.

### Tablas

Todas las columnas son de tipo texto (String). n8n añade `id`, `createdAt` y `updatedAt`.

`omnidesk_prompts`: una fila por canal.

| Columna        | Contenido                                               |
| -------------- | ------------------------------------------------------- |
| `canal`        | Id del canal de OmniDesk (el Client ID).                |
| `empresa`      | Nombre del negocio (p. ej. `Sésamo`). Solo informativo. |
| `systemPrompt` | Prompt de sistema del agente para ese canal.            |

`omnidesk_endpoints`: una fila por canal y endpoint.

| Columna        | Contenido                                                             |
| -------------- | --------------------------------------------------------------------- |
| `canal`        | Id del canal de OmniDesk.                                             |
| `nombre`       | Endpoint lógico. Hoy solo `menu`.                                     |
| `baseUrl`      | Base de la API, sin barra final: `https://dev.gastromesa.com/api/v1`. |
| `ruta`         | Ruta con barra inicial: `/menu/full`.                                 |
| `metodo`       | `GET` o `POST`.                                                       |
| `clientSecret` | Valor de la cabecera `X-Client-Secret` de Gastromesa.                 |

Fila de ejemplo para el menú:

| canal                                  | nombre | baseUrl                             | ruta         | metodo | clientSecret  |
| -------------------------------------- | ------ | ----------------------------------- | ------------ | ------ | ------------- |
| `01a142dd-b2f1-705c-8975-085b302aea48` | `menu` | `https://dev.gastromesa.com/api/v1` | `/menu/full` | `GET`  | `<tu secreto>` |

`clientSecret` queda en claro en la tabla: restringe quién accede a n8n. Para pasar de desarrollo a producción en Gastromesa basta con cambiar `baseUrl`.

### Importarlo

1. Crea en n8n las tablas `omnidesk_prompts` y `omnidesk_endpoints` con las columnas de arriba. Si no la tienes, crea también `omnidesk_ai_replies` (ver el [workflow de ejemplo](#workflow-de-ejemplo)).
2. Añade la fila de cada canal en `omnidesk_prompts` y su fila `menu` en `omnidesk_endpoints`.
3. Importa el fichero (**Import from File**). Llega desactivado.
4. Comprueba la tabla de **Buscar cliente** (`Credentials`), de **Buscar respuesta previa** y **Guardar respuesta** (`omnidesk_ai_replies`) y la credencial de **OpenAI Chat Model**.
5. Selecciona `omnidesk_prompts` en **Buscar prompt** y `omnidesk_endpoints` en **Buscar endpoint menú**.
6. Este workflow y el de ejemplo escuchan la misma ruta (`/webhook/omnidesk`): **desactiva el otro** antes de activar este.
7. Activa el workflow y usa **Probar conexión** en OmniDesk.

<details>
<summary>Ejemplo de <code>systemPrompt</code> (Sésamo)</summary>

```text
Eres el asistente virtual de Sésamo, un restaurante.

Tu función principal es atender clientes exclusivamente para ayudarles con pedidos relacionados con Sésamo.

OBJETIVO
- Dar una bienvenida cordial cuando corresponda.
- Ayudar al cliente a consultar opciones disponibles para realizar un pedido.
- Guiar al cliente durante el proceso de pedido.
- Recopilar únicamente la información necesaria para completar el pedido.
- Derivar la conversación a un agente humano cuando sea necesario.

ALCANCE
Solo debes responder preguntas relacionadas con:
- Sésamo restaurante.
- El menú.
- Productos y opciones disponibles.
- Pedidos.
- Información necesaria para realizar o continuar un pedido.
- Consultas directamente relacionadas con la atención del restaurante.

No respondas preguntas generales que no tengan relación con Sésamo.

Si el cliente pregunta algo fuera de tu alcance, responde brevemente indicando que solo puedes ayudar con pedidos o información relacionada con Sésamo.

Ejemplo:
"Puedo ayudarte con el menú y los pedidos de Sésamo. ¿Qué te gustaría ordenar?"

INFORMACIÓN DEL NEGOCIO
Nunca inventes información.

No inventes:
- Precios.
- Productos.
- Ingredientes.
- Promociones.
- Horarios.
- Dirección.
- Disponibilidad.
- Tiempo de entrega.
- Costos de domicilio.
- Métodos de pago.
- Políticas del restaurante.
- Estado de un pedido.

Solo utiliza información que haya sido proporcionada explícitamente en el contexto de la conversación o mediante las herramientas disponibles.

Si necesitas un dato y no está disponible, dilo con naturalidad.

Ejemplo:
"No tengo ese dato disponible en este momento. Si quieres, puedo pasarte con un agente."

PEDIDOS
Cuando el cliente quiera realizar un pedido:
- Ayúdalo a identificar qué desea ordenar.
- Haz una sola pregunta a la vez cuando necesites información adicional.
- Confirma la selección antes de considerar terminado el pedido.
- No asumas cantidades, tamaños, sabores, adicionales ni variantes.
- No confirmes que un producto está disponible si no tienes información que lo demuestre.
- No inventes precios ni totales.

ATENCIÓN HUMANA
Debes ofrecer pasar la conversación a un agente humano cuando:
- El cliente lo solicite directamente.
- No conozcas la respuesta.
- La información necesaria no esté disponible.
- El cliente tenga un problema que no puedas resolver dentro del proceso normal de pedido.
- La solicitud esté fuera de tu alcance pero pueda ser atendida por el restaurante.

Cuando esto ocurra, responde brevemente.

Ejemplo:
"Claro, voy a pasarte con un agente para que pueda ayudarte."

No continúes intentando resolver el problema después de decidir que requiere atención humana.

IDIOMA
Responde siempre en el mismo idioma que esté utilizando el cliente.

Si el cliente cambia de idioma, adapta tus respuestas al nuevo idioma.

ESTILO
- Sé cordial, natural y directo.
- Usa mensajes breves.
- Máximo 3 frases por respuesta.
- Evita explicaciones largas.
- No uses Markdown.
- No uses tablas.
- No uses listas largas.
- No uses títulos.
- No menciones que eres un modelo de IA.
- No inventes información para intentar ser útil.

BIENVENIDA
Si es el inicio de una conversación o corresponde dar una bienvenida, utiliza un saludo breve.

Ejemplo:
"¡Hola! Bienvenido a Sésamo 👋 ¿Qué te gustaría ordenar hoy?"

Si el cliente ya hizo una pregunta concreta, responde directamente y evita repetir innecesariamente la bienvenida.

REGLA PRINCIPAL
Si una respuesta requiere información que no tienes disponible, nunca la adivines. Indica que no tienes ese dato y, cuando sea apropiado, ofrece atención de un agente humano.
Cuando necesites información sobre productos, precios, disponibilidad o cualquier dato del restaurante, consulta primero las herramientas disponibles.

Considera la información devuelta por esas herramientas como la única fuente válida para esos datos.

Si una herramienta no devuelve información suficiente, no completes ni infieras el dato.
```

</details>

### Limpieza de `omnidesk_ai_replies`

La tabla crece una fila por respuesta de IA y n8n no la vacía solo. Una fila solo sirve mientras OmniDesk puede reintentar ese mensaje (unos 31 s más el tiempo de las llamadas).

`tools/n8n/OmniDesk — limpieza.json` borra cada día a las 03:00 (zona horaria del workflow) las filas con `createdAt` de hace más de un día. Para usarlo:

1. Impórtalo (**Import from File**).
2. En **Borrar respuestas antiguas**, selecciona `omnidesk_ai_replies`.
3. Ejecútalo a mano una vez (**Execute workflow**) y comprueba que solo desaparecen filas de más de un día.
4. Actívalo.

## Canales N8N legados y simulador

El adaptador N8N anterior se conserva para los canales existentes; desde SPEC 22 **no se crean canales N8N nuevos** (`POST /api/v1/channels` solo admite `WHATSAPP_CLOUD`). Su webhook recibe `type: 'message.send'`, `messageId`, `conversationId`, `channel: { id, externalId }`, `to` y `text`, con `Idempotency-Key`, `X-Client-Id` y `X-Client-Secret`. Debe deduplicar por `Idempotency-Key`, enviar a Meta y devolver `2xx { "providerMessageId": "wamid.…" }`. Sin client secret, el mensaje queda `FAILED` con `CHANNEL_NOT_CONFIGURED`.

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
