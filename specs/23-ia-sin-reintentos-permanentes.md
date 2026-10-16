# SPEC 23 — La IA no reintenta errores permanentes de n8n

> **Status:** Approved
> **Depends on:** SPEC 09, SPEC 22
> **Date:** 2026-10-16
> **Objective:** Una llamada `ai.reply` a n8n solo se reintenta ante errores transitorios (408, 429, 500, 502, 503, 504, red o timeout); cualquier otro fallo deja el mensaje para atención humana al primer intento, y el workflow importable de `tools/n8n` responde de verdad a `ai.reply`.

## Por qué existe este spec

Sale de la petición del 2026-10-16: "al enviar mensaje del cliente y está activada la IA, llama a n8n pero ese request se ejecuta varias veces".

La causa:

1. El workflow del usuario (`tools/n8n/OmniDesk — entrada.json`) solo implementa `ping`. A `ai.reply` responde `501 { ok: false }`.
2. `AiReplyWorker` (`apps/api/src/modules/whatsapp/ai-reply-worker.ts`) lanza `IA HTTP 501` ante cualquier respuesta que no sea `2xx`.
3. `OutboxDispatcher` trata `ai.reply_requested` como un envío (`failSend`): 5 reintentos con esperas de 1, 2, 4, 8 y 16 s.

Resultado: 6 ejecuciones en n8n en unos 31 s por cada mensaje del cliente. Ninguna podía salir bien. Con un LLM detrás, cada reintento cuesta dinero.

Lo que ya fijaron otros specs y aquí no se reabre:

- Contrato de `ai.reply` (cuerpo, respuesta `{ text }` con `MessageTextSchema`), timeout de 10 s, `Idempotency-Key`, no seguir redirecciones (SPEC 09).
- Cabeceras `X-Client-Id` / `X-Client-Secret` (SPEC 22).
- Backoff de 1, 2, 4, 8 y 16 s (`SEND_MAX_RETRIES = 5`) para los errores que sí se reintentan.
- `controlVersion` y la doble comprobación de la configuración antes de registrar la respuesta (SPEC 04 y 09).

## Alcance

**Dentro:**

- **Clasificación de fallos de `ai.reply`** en `AiReplyWorker`:
  - **Transitorios** (se reintentan como hoy):
    - HTTP `408`, `429`, `500`, `502`, `503` y `504`.
    - Errores de red y timeout de `fetch` (`TypeError`, `TimeoutError`, `AbortError`).
    - Cualquier error al registrar la respuesta en la base (la transacción final).
  - **Permanentes** (no se reintentan):
    - Cualquier otro HTTP no `2xx`: resto de `4xx` (incluidos `400`, `401`, `403`, `404`), `501`, `505` y superiores.
    - Respuesta `2xx` cuyo cuerpo no es JSON o no cumple `N8nAiReplyResponseSchema` (sin `text`, `text` vacío o de más de 4096 caracteres).
  - Una redirección (`redirect: 'error'` hace fallar `fetch` con `TypeError`) se trata como transitoria: no se distingue de un error de red. Ver "Decisiones".
- **Error de dominio nuevo** `PermanentAiReplyError` en `apps/api/src/modules/whatsapp/ai-reply-errors.ts`, con el mismo patrón que `PermanentDownloadError` (SPEC 14). Mensajes:
  - HTTP: `IA HTTP <status>` (el mismo texto de hoy).
  - Cuerpo inválido: `IA respuesta inválida`.
- **Outbox** (`outbox-dispatcher.ts`):
  - `ai.reply_requested` deja de pasar por `failSend` y usa un método propio `failAiReply`.
  - Con `PermanentAiReplyError`: marca el evento publicado con `lastError` = mensaje, al primer intento, y registra `warn` `Outbox <id>: IA abandonada sin reintentos: <motivo>`.
  - Con cualquier otro error: el mismo backoff y tope que hoy (1, 2, 4, 8 y 16 s; después se marca publicado con el error).
  - `message.send` (`failSend`) no cambia.
- **Efecto visible:** ninguno nuevo en la web. Como hoy al agotar reintentos, el mensaje del cliente queda en la bandeja para atención humana, sin respuesta de IA, y el fallo queda en `outbox_events.last_error`.
- **Workflow importable** `tools/n8n/OmniDesk — entrada.json` (sustituye a `tools/n8n/omnidesk-webhook.json`, que se borra):
  - Conserva `OmniDesk` (Webhook `POST /omnidesk`, respuesta por nodo), `Buscar cliente` (tabla de datos `Credentials` por `clientId` + `clientSecret`) y el `If` de cliente válido.
  - Cliente no válido: responde `401 { ok: false }`.
  - Nodo **Switch** `Tipo` sobre `body.type`:
    - `ping` → responde `200 { ok: true }`.
    - `ai.reply` → rama de IA (abajo).
    - Cualquier otro → responde `400 { ok: false }`.
  - Rama `ai.reply`:
    1. `Buscar respuesta previa`: tabla de datos `omnidesk_ai_replies`, `get` por `idempotencyKey` = cabecera `idempotency-key`, `limit 1`, `alwaysOutputData`.
    2. `If` `¿Ya respondida?` (existe `text`): si sí, responde `200 { text }` con el texto guardado, sin llamar al modelo.
    3. Si no, nodo **AI Agent** con:
       - Entrada: `body.text`.
       - Prompt de sistema genérico en español, editable en el nodo: asistente de atención al cliente por WhatsApp, respuestas breves, sin inventar datos del negocio y ofreciendo pasar con una persona si no sabe la respuesta.
       - **Anthropic Chat Model** con `claude-haiku-5-5`. La credencial de Anthropic se elige al importar.
       - **Simple Memory** con `sessionKey` = `body.conversationId` y ventana de 10 mensajes.
    4. `Guardar respuesta`: inserta `{ idempotencyKey, text }` en `omnidesk_ai_replies`.
    5. Responde `200 { text }` con la salida del agente.
  - Si el agente falla (Anthropic caído, timeout del modelo), el workflow termina en error y n8n responde `500`: OmniDesk lo reintenta.
  - Los ids de tablas de datos y credenciales del export se dejan como en el export del usuario para `Credentials`. Para `omnidesk_ai_replies` y la credencial de Anthropic, el usuario los selecciona tras importar.
- **Documentación** `docs/integracion-n8n.md`:
  - "Ping y límites": qué se reintenta y qué no, con la lista de códigos.
  - Sustituir la referencia a `omnidesk-webhook.json` por `OmniDesk — entrada.json`.
  - Pasos para importar: crear la tabla `omnidesk_ai_replies` (columnas `idempotencyKey` y `text`, ambas texto), seleccionarla en los dos nodos, elegir la credencial de Anthropic y activar el workflow.

**Fuera de alcance (para futuros specs):**

- No reintentar errores permanentes en `message.send` (n8n y WhatsApp Cloud/Meta).
- Mostrar en la web que la IA falló en una conversación.
- Desactivar la IA del canal automáticamente tras varios fallos permanentes.
- Respetar la cabecera `Retry-After` de un `429` o `503`.
- Prompt de sistema por canal (columna en la tabla de credenciales de n8n).
- Implementar `message.send` en el workflow de n8n (solo lo usan los canales N8N heredados).
- Historial de la conversación enviado por OmniDesk a n8n.

## Modelo de datos

Este spec no introduce datos nuevos en OmniDesk: ni columnas, ni migración, ni cambios de contrato.

```ts
// apps/api/src/modules/whatsapp/ai-reply-errors.ts
/** n8n respondió algo que no mejora reintentando (4xx, 501, cuerpo inválido): la IA se abandona. */
export class PermanentAiReplyError extends Error {
  /* name = 'PermanentAiReplyError' */
}

// Códigos HTTP que sí se reintentan.
const TRANSIENT_AI_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
```

Tabla de datos nueva en n8n (no en OmniDesk), `omnidesk_ai_replies`:

| Columna          | Tipo   | Contenido                                       |
| ---------------- | ------ | ----------------------------------------------- |
| `idempotencyKey` | string | Cabecera `Idempotency-Key` (= `messageId`).     |
| `text`           | string | Respuesta devuelta a OmniDesk para esa clave.   |

## Plan de implementación

1. **Error permanente.** Crear `ai-reply-errors.ts` con `PermanentAiReplyError`.
2. **Clasificar en el worker.** En `AiReplyWorker.process`: un HTTP no `2xx` fuera de `TRANSIENT_AI_STATUSES` lanza `PermanentAiReplyError('IA HTTP <status>')`; los de la lista siguen lanzando `Error`. Un cuerpo no JSON o que no cumple `N8nAiReplyResponseSchema` lanza `PermanentAiReplyError('IA respuesta inválida')`. Los errores de `fetch` y de la transacción no cambian.
3. **Outbox.** En `outbox-dispatcher.ts`, separar `ai.reply_requested` de `failSend` con `failAiReply(event, reason, permanent, now)`, al estilo de `failDownload`. Pruebas unitarias en `outbox-dispatcher.spec.ts`: transitorio 6 llamadas y luego publicado; permanente 1 llamada y publicado con `lastError`; `message.send` sigue reintentando un error cualquiera.
4. **e2e.** En `apps/api/test/whatsapp.e2e-spec.ts`:
   - El caso "un fallo de IA conserva inbound y programa un reintento durable" (`503`) sigue igual.
   - Nuevo: n8n responde `501` → tras un `tick`, el evento está publicado con `attempts = 0`, `lastError = 'IA HTTP 501'`, `fetch` llamado una vez y ningún mensaje de IA.
   - Nuevo: n8n responde `429` → `attempts = 1` y sin publicar.
   - El caso `invalid` (`{ text: '' }`) pasa a esperar `PermanentAiReplyError`.
5. **Workflow.** Reescribir `tools/n8n/OmniDesk — entrada.json` con los nodos del alcance y borrar `tools/n8n/omnidesk-webhook.json`. Comprobar que es JSON válido y que todas las conexiones apuntan a nodos existentes.
6. **Docs.** Actualizar `docs/integracion-n8n.md` (reintentos, fichero del workflow, pasos de importación).

## Criterios de aceptación

- [ ] Con n8n respondiendo `501` a `ai.reply`, n8n recibe **una** petición por mensaje del cliente, y el evento `ai.reply_requested` queda publicado con `last_error = 'IA HTTP 501'` y `attempts = 0`.
- [ ] Con n8n respondiendo `400`, `401`, `403` o `404`, n8n recibe una sola petición.
- [ ] Con n8n respondiendo `200 { "text": "" }` o un cuerpo no JSON, n8n recibe una sola petición y el `last_error` es `IA respuesta inválida`.
- [ ] Con n8n respondiendo `503`, `429` o con timeout, el evento se reintenta con esperas de 1, 2, 4, 8 y 16 s (6 peticiones en total) y luego queda publicado.
- [ ] Un `503` seguido de un `200 { text }` en el reintento registra y envía la respuesta de IA una sola vez.
- [ ] En todos los fallos, el mensaje del cliente sigue en la base y no existe ningún mensaje con `senderType = 'AI'`.
- [ ] Un `message.send` que falla con un error cualquiera se sigue reintentando 5 veces antes de pasar a `FAILED`.
- [ ] `tools/n8n/omnidesk-webhook.json` ya no existe y `tools/n8n/OmniDesk — entrada.json` se importa en n8n sin errores.
- [ ] Con el workflow importado y configurado, "Probar conexión" responde `ok: true`.
- [ ] Con el workflow importado y la IA activa, un mensaje del cliente recibe una respuesta de IA en la conversación y n8n muestra una sola ejecución.
- [ ] Repetir a mano la misma petición `ai.reply` (misma `Idempotency-Key`) contra n8n devuelve el mismo `text` sin ejecutar el nodo AI Agent.
- [ ] Una petición al workflow con `X-Client-Secret` incorrecto responde `401`; con un `type` desconocido, `400`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y los e2e de la API pasan.

## Decisiones

- **Sí:** solo `ai.reply`. Es el problema observado y su fallo no lo ve nadie: el mensaje queda para atención humana igual. Decisión del usuario.
- **No:** aplicar el criterio a `message.send` ahora. Allí un `FAILED` lo ve el agente, y Meta usa `400` para casos con matices (ventana de 24 h). Va en otro spec si hace falta.
- **Sí:** transitorios = `408`, `429`, `500`, `502`, `503`, `504`, red y timeout. Son los códigos que la especificación HTTP y los proxies usan para "inténtalo luego". Decisión del usuario.
- **No:** "cualquier 5xx es transitorio". `501 Not Implemented` es justo el caso que originó el spec y no se arregla solo.
- **No:** "cualquier 4xx es permanente". Un `429` de n8n o de un proxy delante se perdería sin reintento.
- **Sí:** cuerpo inválido en un `2xx` es permanente. El workflow devolvió lo que su configuración produce; repetir da lo mismo y vuelve a pagar el modelo.
- **Sí:** una redirección se reintenta. `fetch` con `redirect: 'error'` lanza el mismo `TypeError` que un fallo de red; distinguirlo exige parsear mensajes de error de undici, que no son contrato. El coste es como mucho 6 llamadas en una configuración ya rota.
- **Sí:** error de dominio propio (`PermanentAiReplyError`) en lugar de leer el status desde el dispatcher. El patrón ya existe con `PermanentDownloadError` y el dispatcher no sabe de HTTP.
- **No:** marcar algo como `FAILED`. La IA no tiene un mensaje propio que marcar; abandonar el evento es lo mismo que hoy al agotar los reintentos.
- **Sí:** ajustar `OmniDesk — entrada.json` y borrar `omnidesk-webhook.json`. Decisión del usuario: queda el export real como único workflow.
- **Sí:** AI Agent con Anthropic y `claude-haiku-5-5`. Es el más rápido, con margen frente al timeout de 10 s. Decisión del usuario.
- **Sí:** memoria por `conversationId` en n8n (Simple Memory). OmniDesk no envía historial; sin memoria cada respuesta ignora lo anterior.
- **Sí:** deduplicar en n8n con la tabla `omnidesk_ai_replies` antes de llamar al modelo, como ya pide `docs/integracion-n8n.md`. Un timeout de OmniDesk tras generar la respuesta no vuelve a pagar el modelo. Decisión del usuario.
- **Sí:** prompt genérico en el nodo, editable tras importar. Decisión del usuario; el prompt por canal queda fuera.
- **Sí:** si el agente falla, n8n responde `500` y OmniDesk reintenta. Una caída de Anthropic sí puede arreglarse sola.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Un `4xx` puntual de un proxy (p. ej. `403` de Cloudflare por un pico) deja un mensaje sin IA. | El mensaje queda en la bandeja para atención humana, como al agotar reintentos. El motivo queda en `last_error` y en el log. |
| Simple Memory de n8n vive en memoria del proceso: se pierde al reiniciar n8n y no se comparte entre workers en modo cola. | Aceptado para un workflow de ejemplo. Una memoria persistente (Postgres o Redis) es un cambio en n8n, no en OmniDesk. |
| La tabla `omnidesk_ai_replies` crece sin límite. | Una fila corta por mensaje con IA. Limpiarla es tarea de n8n; se menciona en la documentación. |
| El nodo AI Agent tarda más de 10 s con contexto largo. | `claude-haiku-5-5` y ventana de 10 mensajes. Si pasa, es timeout → se reintenta, y la respuesta generada queda en `omnidesk_ai_replies` para el reintento. |
| El export trae ids de tabla y credenciales de la instancia del usuario. | `Credentials` es de su instancia y se conserva. Los recursos nuevos se seleccionan tras importar; la documentación lo indica. |

## Qué **no** entra en este spec

- Errores permanentes en `message.send` (n8n y Meta).
- Avisos en la web de fallos de IA.
- Apagar la IA automáticamente tras fallos repetidos.
- `Retry-After`.
- Prompt de sistema por canal.
- `message.send` en el workflow de n8n.

Cada uno de esos, si llega, va en su propio spec.
