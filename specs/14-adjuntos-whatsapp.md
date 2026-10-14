# SPEC 14 — Adjuntos de WhatsApp: recibir, ver y enviar archivos

> **Status:** Draft
> **Depends on:** SPEC 05, SPEC 09, SPEC 10
> **Date:** 2026-10-13
> **Objective:** Los adjuntos que el cliente envía por WhatsApp (imagen, documento, audio, video, sticker) llegan a la bandeja, se guardan en MinIO y se ven en el chat, y el agente asignado puede responder con un archivo y un pie de texto opcional.

## Por qué existe este spec

Hoy un cliente que manda una foto no aparece en OmniDesk. Se comprobó con el último webhook real recibido (`/tmp/wa-last.json` del contenedor `api`):

```json
{ "type": "image", "image": { "mime_type": "image/jpeg", "sha256": "OB6b…=", "id": "1501404631865040", "url": "https://lookaside.fbsbx.com/…" } }
```

`parseWhatsAppEvents` (`apps/api/src/modules/whatsapp/whatsapp-protocol.ts`) solo acepta `type: 'text'`. Cualquier otro tipo se descarta sin error. El controlador registra `Webhook sin estados: … keys=messaging_product,metadata,contacts,messages status=ninguno` y responde `200`. Meta da el webhook por entregado y no lo reintenta: **el mensaje se pierde**.

Tampoco hay forma de enviar archivos: `Message` solo tiene `text`, el composer solo tiene texto y `WhatsAppCloudProvider` solo envía `type: 'text'`.

## Cómo funciona el media en WhatsApp Cloud API

- **Entrante.** El webhook trae `type` (`image`, `document`, `audio`, `video`, `sticker`…) y un objeto con ese nombre: `id` (media id), `mime_type`, `sha256`, `caption?`, `filename?` (documento) y `voice?` (nota de voz). El webhook **no trae los bytes**. Para descargarlos:
  1. `GET https://graph.facebook.com/{version}/{media-id}` con `Authorization: Bearer <access token>`. Devuelve `{ url, mime_type, sha256, file_size, id }`.
  2. `GET {url}` con el mismo Bearer. La `url` caduca a los **5 minutos**; el media id dura **30 días** y después Meta borra el archivo.
  - Por eso hay que descargar y guardar el archivo nosotros, de forma asíncrona y con reintentos, sin hacer esperar al webhook. Meta exige respuesta rápida.
- **Saliente.** `POST /{phone-number-id}/media` (multipart: `file`, `type`, `messaging_product=whatsapp`) devuelve `{ id }`. Después, `POST /{phone-number-id}/messages` con `type: image|document|audio|video` y `{ id, caption?, filename? }`. Los audios no llevan `caption`. La alternativa de enviar un `link` público se descarta porque MinIO no es público.
- **Límites de Meta:** imagen 5 MB (`image/jpeg`, `image/png`); video 16 MB (`video/mp4`, `video/3gpp`); audio 16 MB (`audio/aac`, `audio/amr`, `audio/mpeg`, `audio/mp4`, `audio/ogg` solo con opus); documento 100 MB; sticker 100 KB estático o 500 KB animado (`image/webp`); pie de foto de 1024 caracteres como máximo.

## Alcance

**Dentro:**

- **Recepción:** imagen, documento, audio, nota de voz, video y sticker de WhatsApp Cloud. Se guardan con su pie (`caption`) como texto del mensaje.
- **Tipos no soportados** (ubicación, contactos, botones, interactivos, `unsupported`): se registran como un mensaje de texto `[Mensaje de WhatsApp no soportado: <tipo>]` para que no se pierdan en silencio. Las reacciones (`reaction`) se ignoran porque no son un mensaje nuevo.
- **Descarga asíncrona por Outbox** (`attachment.download_requested`). Verifica el `sha256` y un tope de tamaño, y guarda en MinIO. El adjunto pasa a `READY` o, tras 5 reintentos o un error permanente, a `FAILED`.
- **Almacenamiento en MinIO** (S3 compatible) como contenedor Docker. El puerto S3 se publica en el host en **9050** (consola en 9051, solo en local). Bucket privado: los archivos solo salen por el API.
- **Ver en la app:** imagen (miniatura con visor dentro de la app), sticker, video y audio con reproductor, y documento como tarjeta con nombre, tamaño y descarga. Estados "Descargando…" y "No se pudo descargar".
- **Endpoint de contenido** `GET /api/v1/attachments/:id/content`, con sesión y los mismos permisos de vista que la conversación. Admite `Range` (iOS Safari lo exige para video y audio).
- **Envío:** el agente asignado adjunta **un archivo por mensaje** con pie opcional. Imagen, documento, audio y video, con los límites de Meta y documento limitado a 16 MB. Endpoint multipart `POST /api/v1/conversations/:id/messages/attachments`, idempotente por `clientMessageId`, con el rate limit `send-message`.
- **Proveedor WhatsApp Cloud:** sube el media a Graph y envía el mensaje con el media id. Reintentos y estados como los mensajes de texto.
- **IA (n8n):** los mensajes con adjunto **no disparan la IA**: quedan para atención humana. Tampoco la disparan los no soportados.
- **Vista previa** en la lista: "Foto", "Video", "Audio", "Nota de voz", "Sticker", "Documento: <nombre>", con el pie si lo hay.
- **Infra y docs:** MinIO en `docker-compose.yml` y en `infra/deploy/docker-compose.prod.yml`, `client_max_body_size` en Nginx, backup diario del volumen de MinIO, variables nuevas y documentación.

**Fuera:**

- Enviar varios archivos a la vez, arrastrar y soltar, pegar desde el portapapeles, o grabar notas de voz desde la app.
- Enviar stickers, ubicaciones, contactos o plantillas.
- Transcodificar (p. ej. `ogg/opus` a `mp3` para Safari antiguo) y generar miniaturas en el servidor.
- Antivirus o análisis del contenido.
- Pasar adjuntos a n8n o a la IA.
- Adjuntos en los canales `N8N` (legado): el envío falla como `CHANNEL_NOT_CONFIGURED`. En `SIMULATED` el envío se simula.
- Borrado de archivos por retención: lo hace el job de SPEC 12 (ver Riesgos).
- URLs firmadas de MinIO y CDN.

## Modelo de datos

```prisma
enum AttachmentKind {
  IMAGE
  DOCUMENT
  AUDIO
  VIDEO
  STICKER
}

enum AttachmentStatus {
  /// Entrante aún sin descargar de Meta.
  PENDING
  READY
  FAILED
}

model MessageAttachment {
  id              String           @id @default(uuid(7)) @db.Uuid
  tenantId        String           @map("tenant_id") @db.Uuid
  messageId       String           @unique @map("message_id") @db.Uuid
  kind            AttachmentKind
  mimeType        String           @map("mime_type")
  fileName        String?          @map("file_name")
  sizeBytes       Int?             @map("size_bytes")
  /// Nota de voz grabada en WhatsApp.
  voice           Boolean          @default(false)
  /// sha256 que reporta Meta (base64 en el webhook): se verifica al descargar.
  sha256          String?
  /// Media id de Meta (entrantes): con él se descarga.
  providerMediaId String?          @map("provider_media_id")
  /// Clave del objeto en el bucket; null mientras está PENDING.
  storageKey      String?          @map("storage_key")
  status          AttachmentStatus
  failureReason   String?          @map("failure_reason")
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(3)

  tenant  Tenant  @relation(fields: [tenantId], references: [id])
  message Message @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("message_attachments")
}
```

- `Message` gana `attachment MessageAttachment?`. `Message.text` sigue siendo obligatorio: vale `''` si el adjunto no tiene pie.
- Clave en el bucket: `tenants/<tenantId>/attachments/<id>` para los entrantes (determinista: un reintento sobrescribe y no deja huérfanos). Para los salientes, `tenants/<tenantId>/attachments/out-<uuid>`, porque el objeto se sube antes de que exista la fila.
- Contrato `MessageSchema.attachment`: `{ id, kind, mimeType, fileName, sizeBytes, voice, status } | null`. La URL se deriva con `attachmentContentPath(id)`.
- Variables nuevas: `ATTACHMENT_STORAGE_DRIVER` (`memory` | `s3`; por defecto `memory`, obligatorio `s3` en producción), `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` y `ATTACHMENT_INBOUND_MAX_BYTES` (por defecto 25 MB).

## Plan de implementación

El detalle por tareas, con código y pruebas, está en `docs/superpowers/plans/2026-10-13-adjuntos-whatsapp.md`.

1. **Contratos:** tipos, límites y validación de MIME compartidos por API y web; `MessageSchema.attachment`.
2. **Modelo:** migración, dominio `Message` con adjunto, vista previa, repositorios y DTO.
3. **Almacenamiento:** puerto `AttachmentStorage`, adaptadores S3 (MinIO) y memoria, variables de entorno y MinIO en el compose local.
4. **Recepción:** parser de media y no soportados; el webhook registra el adjunto `PENDING`, encola la descarga y no llama a la IA.
5. **Descarga:** worker Graph → MinIO con sha256, tope de tamaño, reintentos y `FAILED`; evento en tiempo real al terminar.
6. **Contenido:** `GET /attachments/:id/content` con permisos, cabeceras seguras y `Range`.
7. **Envío (API):** endpoint multipart, validación y subida a MinIO; el mensaje queda `PENDING` en el Outbox.
8. **Envío (proveedor):** subida a Graph y mensaje con media id; `SIMULATED` lo simula y `N8N` lo rechaza.
9. **Web:** render de adjuntos, visor, composer con clip, chip y validación, y envío multipart.
10. **Infra y docs:** MinIO en producción, Nginx, backup del volumen y documentación.
11. **Verificación:** lint, tipos, unitarias, e2e y prueba real con un número de WhatsApp.

## Criterios de aceptación

- [ ] Una foto enviada desde WhatsApp aparece en la bandeja una sola vez y se ve en el chat en menos de 10 s en condiciones normales.
- [ ] Documento, audio, nota de voz, video y sticker entrantes se registran con su tipo, nombre (documento) y pie.
- [ ] Un tipo no soportado aparece como `[Mensaje de WhatsApp no soportado: <tipo>]`; una reacción no crea mensajes.
- [ ] El webhook responde `200` sin esperar la descarga; un webhook repetido no duplica mensajes ni descargas.
- [ ] Un sha256 que no coincide o un archivo mayor que `ATTACHMENT_INBOUND_MAX_BYTES` deja el adjunto `FAILED` y el chat muestra "No se pudo descargar".
- [ ] Un fallo transitorio de Graph se reintenta hasta 5 veces; después el adjunto queda `FAILED`.
- [ ] Un mensaje con adjunto no genera `ai.reply_requested`, aunque la IA esté activa.
- [ ] `GET /attachments/:id/content` devuelve `404` a otro tenant, a quien no puede ver la conversación y si el adjunto no está `READY`. Con `Range` responde `206` con `Content-Range`.
- [ ] Los documentos y los tipos no multimedia se sirven como `attachment`; todo lleva `nosniff` y `Content-Security-Policy: sandbox`.
- [ ] El agente asignado envía imagen, documento, audio y video con pie opcional, y ve los ticks de entrega; repetir el `clientMessageId` no duplica.
- [ ] `415` con un tipo no admitido, `413` si supera el límite del tipo, `400` si un audio lleva pie o falta el archivo, `403` si no es el agente asignado, `409` si está cerrada.
- [ ] Un envío con adjunto que falla puede reintentarse desde la web y vuelve a subir el archivo a Graph.
- [ ] En producción el API no arranca sin `ATTACHMENT_STORAGE_DRIVER=s3` y las credenciales S3; MinIO no se expone fuera de `127.0.0.1`.
- [ ] El backup diario incluye un `.tar.gz` del volumen de MinIO con la misma rotación de 7.
- [ ] Lint, typecheck, test, build y e2e pasan; la prueba real con WhatsApp (recibir y enviar los cuatro tipos) está documentada.

## Decisiones tomadas y descartadas

- **MinIO en Docker** (elegida por el usuario, puerto 9050) frente a disco local o `bytea` en Postgres. Es S3 compatible: el adaptador sirve igual para R2 o AWS S3. Se fija `minio/minio:RELEASE.2025-09-07T16-13-09Z`, la versión instalada en la máquina de desarrollo.
- **Un archivo por mensaje con pie opcional** (elegida). Así funciona WhatsApp y encaja con `Message` 1:1. La tabla aparte permite pasar a 1:N más adelante.
- **Los adjuntos no disparan la IA** (elegida): quedan para atención humana.
- **Descargar por Outbox, no dentro del webhook.** Meta exige respuesta rápida y la URL caduca en 5 minutos: cada intento pide una URL nueva con el media id.
- **Servir por el API con la sesión**, no con URLs firmadas de MinIO: no se expone MinIO y se reutilizan los permisos de la conversación. Funciona con `<img>` y `<video>` del mismo origen y la CSP actual (`default-src 'self'`).
- **Visor dentro de la app, no pestaña nueva:** en la PWA instalada en iOS, una pestaña de Safari no tiene la cookie de la app y la imagen no cargaría.
- **Subir a Graph por `/media`, no `link`:** MinIO no es público.
- **Documento saliente limitado a 16 MB** (Meta admite 100 MB) para acotar memoria, el cuerpo de Nginx y el tiempo dentro de la transacción del Outbox.
- **Driver `memory` por defecto fuera de producción:** las pruebas e2e y los entornos sin MinIO siguen funcionando sin infraestructura nueva.
- **Se descarta** guardar la `url` del webhook: igualmente exige Bearer y caduca a los 5 minutos.

## Riesgos identificados

- **Bloqueo del Outbox.** El dispatcher procesa un evento por transacción, con 20 s de tope, en serie. Una descarga o subida lenta retrasa los eventos en tiempo real de todos. Mitigación: timeouts de 5 s (metadatos) y 12 s (bytes), y tope de 25 MB. Si se queda corto, un worker dedicado de adjuntos es un spec aparte.
- **Distribución de MinIO.** El proyecto dejó de publicar imágenes comunitarias actualizadas en 2025. Hay que fijar la etiqueta y confirmar en el VPS que se puede descargar (o cargarla con `docker save | docker load`). Garage o SeaweedFS son alternativas S3 sin cambiar código.
- **Audio `ogg/opus` en Safari.** Las notas de voz de WhatsApp son `audio/ogg; codecs=opus`. Safari reciente las reproduce, pero las versiones antiguas no. Siempre se muestra el enlace de descarga.
- **Retención (SPEC 12).** Al borrar mensajes, la fila del adjunto cae en cascada, pero el objeto en MinIO no. El job de SPEC 12 debe borrar `storageKey` antes de purgar. Hay que anotarlo en SPEC 12.
- **Ventana de 24 h.** Fuera de la ventana de atención, Meta rechaza también los adjuntos. El mensaje queda `FAILED`, igual que el texto (SPEC 09).
- **Duplicado de envío.** Igual que en SPEC 09: si el proceso cae entre la aceptación de Meta y la persistencia local, un reintento puede duplicar el envío.
