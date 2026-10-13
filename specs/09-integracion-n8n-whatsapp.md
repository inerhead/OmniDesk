# SPEC 09 — WhatsApp Cloud directo e IA opcional con n8n

> **Status:** Approved
> **Depends on:** SPEC 05, SPEC 07, SPEC 08
> **Date:** 2026-10-12
> **Objective:** El administrador de la empresa configura WhatsApp Cloud en Settings y, opcionalmente, activa IA mediante un webhook de n8n. OmniDesk recibe y conserva los mensajes; sin IA llegan a la bandeja para atención humana.

## Decisión confirmada

Este documento sustituye el diseño anterior donde n8n recibía WhatsApp y enviaba las respuestas. El usuario aprobó explícitamente el cambio y su implementación. Se conservan los adaptadores `N8N` y `SIMULATED`, las credenciales y HMAC ya desarrollados para compatibilidad; los canales nuevos de la UI usan `WHATSAPP_CLOUD`.

## Flujo y alcance

1. OWNER o ADMIN (roles de administración existentes) crea un canal en `/settings/channels` con nombre, número E.164 y `phone_number_id`.
2. Configura access token de Meta, app secret y verify token. Los secretos se cifran con AES-256-GCM y nunca se devuelven en lecturas. Settings muestra el callback público propio: `{APP_URL}/api/v1/integrations/whatsapp/{channelId}`.
3. Meta verifica la suscripción mediante GET (`hub.mode`, `hub.verify_token`, `hub.challenge`). Los POST se autentican con `X-Hub-Signature-256` sobre los bytes originales. La ruta identifica el canal; solo se procesan cambios cuyo `phone_number_id` coincide con él.
4. Los mensajes de texto se guardan de forma idempotente por canal e id de Meta, y aparecen en la bandeja. Sin IA no se llama a n8n. Las conversaciones sin agente siguen siendo accesibles a los agentes en la bandeja de pendientes.
5. La IA está desactivada por defecto en canales directos. Activarla requiere URL n8n y secreto HMAC generado. La recepción del mensaje y la solicitud de IA se guardan de forma atómica usando Outbox. El webhook de Meta no espera a la IA.
6. El worker envía a n8n `type: 'ai.reply'`, `messageId`, `conversationId`, `controlVersion`, `channel: { id, externalId }`, `from`, `text`. Cabeceras `X-OmniDesk-Signature` e `Idempotency-Key: messageId`. n8n responde `2xx { text: string }` con el mensaje completo. No envía mensajes a Meta.
7. OmniDesk valida la respuesta, comprueba que la IA siga habilitada y que la conversación siga abierta, sin agente y con el mismo controlVersion; registra la respuesta y encola su envío a WhatsApp. Una respuesta tardía tras desactivar IA o tomar/cerrar la conversación se descarta.
8. Los mensajes humanos y de IA salen directamente por Graph API con el access token del canal. Meta reporta `sent`, `delivered`, `read`, `failed`; OmniDesk aplica las transiciones de entrega existentes.

## Seguridad y fallos

- Cada operación de Settings exige sesión y rol OWNER/ADMIN en la empresa activa. AGENT no ve Canales y recibe 403 en su API.
- HMAC n8n conserva formato `t=<unix>,v1=<hex HMAC_SHA256(secret, t + '.' + rawBody)>`, tolerancia ±300 s y comparación constante. Rotación de API key/secreto con gracia de 24 h, valores visibles una sola vez.
- Las claves Meta son independientes de la API key y el secreto HMAC. El verify token lo proporciona el administrador y no se muestra tras guardar; puede sustituirlo.
- Validación de URL n8n existente: HTTPS en producción, excepciones explícitas con `N8N_WEBHOOK_ALLOWED_HOSTS`, sin IP privadas fuera de la lista. Sin redirecciones HTTP.
- Timeout HTTP 10 s. Reintentos durables con backoff y límite de cinco reintentos. Al fallar la IA, el mensaje recibido permanece disponible para atención humana; el error queda en Outbox, sin respuestas inventadas.
- Idempotencia de IA por mensaje entrante y respuesta por `ai:<messageId>`. n8n debe devolver la misma respuesta para la misma clave.
- Meta no garantiza idempotencia de envío: un fallo entre aceptación remota y persistencia local puede duplicar un envío; no se promete exactly-once. Se incluye correlación del id local en el envío.
- Los secretos no se incluyen en logs. La versión Graph es configuración del servidor (`WHATSAPP_GRAPH_VERSION`).

## Modelo y contratos

Se añade `WHATSAPP_CLOUD` a `ChannelProvider`, y al canal `aiEnabled` (false por defecto), `whatsappAccessTokenEnc`, `whatsappAppSecretEnc`, `whatsappVerifyTokenHash`. Se reutiliza `webhookUrl` exclusivamente como URL de IA en canales directos.

- `GET /api/v1/channels`: resumen sin secretos, con `aiEnabled`, `hasWhatsAppCredentials`, `whatsappWebhookUrl`.
- `POST /api/v1/channels`: nombre, teléfono, externalId, provider (`WHATSAPP_CLOUD` o legado `N8N`); webhook requerido solo para N8N.
- `PATCH /api/v1/channels/:id`: nombre y webhook (nullable para canales directos).
- `PATCH /api/v1/channels/:id/whatsapp`: `accessToken?`, `appSecret?`, `verifyToken?`, `aiEnabled?`. Valores omitidos conservan el valor actual. Activación de IA exige webhook y HMAC.
- `POST /api/v1/channels/:id/credentials`: genera/rota API key y HMAC; sin cambios del contrato existente.
- `POST /api/v1/channels/:id/test`: ping firmado al webhook n8n; resultado y latencia, sin reintentar.
- `GET/POST /api/v1/integrations/whatsapp/:channelId`: handshake y webhook nativo de Meta.

## Plan de implementación

1. **Base existente (pasos originales 1–6):** conservar cripto, migraciones, firma de integraciones, registro de proveedores, adaptador N8N y API de canales; verificar regresiones.
2. **Modelo y configuración:** migración adicional, contratos y configuración segura por empresa; callback público en Settings.
3. **WhatsApp directo:** handshake, firma Meta, traducción de mensajes/estados, aislamiento de canal e idempotencia; proveedor Graph para mensajes humanos e IA.
4. **IA opcional:** Outbox, llamada firmada a n8n, validación de respuesta y control de conversación, envío directo, fallos y reintentos.
5. **Web (paso original 7):** lista, alta/edición, configuración Meta, callback copiable, activación IA, credenciales efímeras, confirmación de rotación y prueba de conexión. Menú OWNER/ADMIN.
6. **Simulador (paso original 8):** conservar firma opcional `SIMULATOR_HMAC_SECRET` y documentar uso con credenciales de prueba.
7. **Documentación (paso original 9):** contrato n8n, arquitectura y README; instrucciones de conexión y límites.
8. **Verificación:** lint, tipos, unitarias, build y e2e; pruebas reales con Meta/n8n requieren credenciales y número externo.

## Criterios de aceptación

- [x] OWNER/ADMIN crea/configura canal directo sin configurar IA; AGENT recibe 403.
- [ ] Settings muestra callback correcto incluyendo subruta pública y permite copiarlo.
- [x] GET de Meta devuelve challenge solo con verify token válido; POST rechaza firma ausente/alterada.
- [x] Lotes se procesan completos y no cruzan canales/empresas.
- [x] Sin IA, inbound aparece una sola vez en la bandeja y no llama a n8n.
- [x] Con IA habilitada, n8n recibe el inbound firmado; `{ text }` se registra y envía por Graph API.
- [x] IA desactivada, conversación cerrada o tomada durante la llamada impiden publicar la respuesta tardía.
- [x] Fallo/timeout de IA conserva inbound y permite atención humana.
- [x] Mensajes humanos no dependen de n8n; los estados Meta actualizan su entrega.
- [x] Secretos Meta cifrados y verify token hasheado; ninguna lectura expone secretos.
- [ ] Generar/rotar HMAC muestra valores solo en el diálogo actual; mantiene gracia de 24 h.
- [ ] Probar conexión muestra éxito/latencia o error.
- [x] Simulador y proveedor N8N legado siguen funcionando.
- [ ] Lint, typecheck, test, build y e2e pasan; prueba real de WhatsApp documentada por separado.

## Fuera de alcance

Plantillas y gestión de ventana de 24 h, multimedia, otros canales, borrado, workflows n8n exportados, rate limiting (SPEC 10). Solo texto libre dentro de las condiciones permitidas por Meta; los errores del proveedor se muestran como fallo de envío.


## Verificación de implementación

- `pnpm lint`, `pnpm typecheck`, `pnpm build` y las 453 pruebas unitarias del monorepo pasan. La suite completa del API pasa 143 e2e (17 específicos de WhatsApp).
- Backend y pantalla Settings implementados en la rama `spec-09-integracion-n8n-whatsapp`.
- Pruebas automatizadas: cripto/HMAC legado, webhook nativo, permisos, aislamiento, deduplicación concurrente, IA opcional, cambios de control, respuesta inválida/timeout, envío humano directo y estados de entrega.
- Los lotes con estados de envíos externos no bloquean los inbound. Una correlación local todavía no visible solicita reintento después de procesar el resto del lote.
- Pendiente de validación operativa: conectar un número real de Meta y un workflow n8n con credenciales del entorno. No se ha enviado un WhatsApp real durante la implementación.
- La revisión visual del navegador queda pendiente: esta sesión no dispone de navegador conectado.
