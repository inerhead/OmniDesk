# Adjuntos de WhatsApp — plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** recibir, guardar en MinIO, ver en el chat y enviar adjuntos de WhatsApp (imagen, documento, audio, video y, solo al recibir, sticker).

**Arquitectura:** el webhook registra el mensaje con un `MessageAttachment` en estado `PENDING` y encola `attachment.download_requested` en el Outbox. Un worker descarga de Graph, verifica el sha256 y guarda en MinIO mediante el puerto `AttachmentStorage`. La web pide los bytes a `GET /api/v1/attachments/:id/content`, con sesión. Para enviar, la web manda un multipart al API; el API guarda el archivo en MinIO y crea el mensaje `PENDING`. Después, el `WhatsAppCloudProvider` lo sube a Graph (`/media`) y envía el mensaje con el media id.

**Stack:** NestJS 11 + Prisma 7 + Postgres 18, `@aws-sdk/client-s3` contra MinIO, multer (incluido en `@nestjs/platform-express`), React 19 + TanStack Query, zod 4 en `@omnidesk/contracts`, vitest 5 y supertest.

**Spec:** `specs/14-adjuntos-whatsapp.md`

## Restricciones globales

- El paquete `@omnidesk/contracts` se consume desde `dist/`. Tras cada cambio en `packages/contracts/src`, ejecuta `pnpm --filter @omnidesk/contracts build` antes de probar el API o la web.
- Imagen de MinIO: `minio/minio:RELEASE.2025-09-07T16-13-09Z`. Puerto S3 en el host: **9050**; consola: **9051** (solo en local).
- Límites salientes: imagen 5 MB (`image/jpeg`, `image/png`); video, audio y documento 16 MB. Cuerpo multipart máximo: 16 MB. Pie de foto máximo: 1024 caracteres. Los audios no llevan pie.
- Tope entrante por defecto: `ATTACHMENT_INBOUND_MAX_BYTES=26214400` (25 MB).
- Timeouts de Graph: 5 s para los metadatos del media; 12 s para descargar o subir los bytes. La transacción del Outbox dura 20 s como máximo.
- Los mensajes con adjunto y los no soportados **nunca** encolan `ai.reply_requested`.
- `ATTACHMENT_STORAGE_DRIVER` vale `memory` por defecto. Con `NODE_ENV=production` es obligatorio `s3`.
- Textos de la UI y comentarios en español, con el estilo actual: comentarios solo para restricciones que el código no muestra.
- La migración nueva va después de `20261015010000_rate_limit_buckets` (trabajo de SPEC 10, aún sin commitear): carpeta `20261016000000_message_attachments`.
- No toques el rate limiting de SPEC 10. Reutiliza `@RateLimit('send-message')`.

## Foco de revisión

1. **Nombre de archivo con tildes o eñes** (`cotización.pdf`): busboy puede entregarlo decodificado como latin1. Se espera que llegue intacto a la base, a WhatsApp y a la descarga. La prueba está en la tarea 7 (e2e `conserva el nombre UTF-8`).
2. **Video y audio en iPhone:** Safari pide `Range: bytes=0-1` y no reproduce sin una respuesta `206` correcta. Se espera `206` con `Content-Range` y `Content-Length` exactos. Pruebas en la tarea 6 (unitarias de `parseRange` y e2e `responde 206`).
3. **Cambiar el archivo tras un error de red:** con el mismo `clientMessageId`, el API devolvería el envío anterior como duplicado. Se espera que un borrador distinto (texto o archivo) use un id nuevo. Prueba en la tarea 9 (`draftKey`).
4. **Webhook repetido por Meta:** no debe duplicar el mensaje ni la descarga. Prueba en la tarea 4 (e2e `no duplica`).
5. **Archivo `.m4a` desde Mac o iPhone:** el navegador declara `audio/x-m4a`. Se espera que se normalice a `audio/mp4` y se acepte. Prueba en la tarea 1 (`normalizeMimeType`).

---

## Estructura de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `packages/contracts/src/attachments.ts` (nuevo) | Tipos, límites, normalización y validación de MIME, ruta del contenido, campos del multipart |
| `packages/contracts/src/conversations.ts` | `MessageSchema.attachment` |
| `apps/api/prisma/schema.prisma` + migración | Tabla `message_attachments` |
| `apps/api/src/modules/conversations/domain/message.ts` | `MessageAttachment`, `NewAttachment`, `previewSource` |
| `apps/api/src/modules/conversations/infrastructure/http/message.mapper.ts` (nuevo) | `toMessageDto`, compartido por dos controladores |
| `apps/api/src/modules/attachments/**` (nuevo módulo) | Almacenamiento, repositorio, descarga encolada, contenido, envío multipart |
| `apps/api/src/modules/whatsapp/whatsapp-protocol.ts` | Parser de media y no soportados |
| `apps/api/src/modules/whatsapp/attachment-download-worker.ts` (nuevo) | Graph → MinIO |
| `apps/api/src/modules/whatsapp/whatsapp-cloud-provider.ts` | Subida a `/media` y envío con media id |
| `apps/api/src/modules/realtime/**` | Enrutar `attachment.download_requested` con reintentos |
| `apps/web/src/features/conversations/**` | Render, visor, composer con clip y envío multipart |
| `docker-compose.yml`, `infra/deploy/*`, `docs/*`, `.env.example` | MinIO, Nginx, backup y documentación |

---

### Tarea 1: Contratos de adjuntos

**Archivos:**
- Crear: `packages/contracts/src/attachments.ts`
- Crear: `packages/contracts/src/attachments.spec.ts`
- Modificar: `packages/contracts/src/index.ts`
- Modificar: `packages/contracts/src/conversations.ts:98-110`

**Interfaces:**
- Produce: `AttachmentKindSchema`, `AttachmentKind`, `AttachmentStatusSchema`, `AttachmentStatus`, `AttachmentSchema`, `Attachment`, `MAX_OUTBOUND_ATTACHMENT_BYTES`, `MAX_ATTACHMENT_CAPTION_LENGTH`, `OUTBOUND_ATTACHMENT_TYPES`, `OUTBOUND_ATTACHMENT_ACCEPT`, `normalizeMimeType(mime): string`, `checkOutboundAttachment({ mimeType, sizeBytes }, caption): OutboundAttachmentCheck`, `OutboundAttachmentRejection`, `attachmentContentPath(id): string`, `SendAgentAttachmentFieldsSchema`, `SendAgentAttachmentFields`. `MessageSchema` gana `attachment: Attachment | null`.

- [ ] **Paso 1: escribir la prueba que falla**

`packages/contracts/src/attachments.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  attachmentContentPath,
  checkOutboundAttachment,
  normalizeMimeType,
  OUTBOUND_ATTACHMENT_ACCEPT,
} from './attachments';
import { MessageSchema } from './conversations';

const MB = 1024 * 1024;

describe('normalizeMimeType', () => {
  it('quita parámetros, pasa a minúsculas y aplica alias de navegadores', () => {
    expect(normalizeMimeType('Audio/OGG; codecs=opus')).toBe('audio/ogg');
    expect(normalizeMimeType('audio/x-m4a')).toBe('audio/mp4');
    expect(normalizeMimeType('image/jpg')).toBe('image/jpeg');
  });
});

describe('checkOutboundAttachment', () => {
  it('acepta un PDF con pie y devuelve DOCUMENT', () => {
    expect(
      checkOutboundAttachment({ mimeType: 'application/pdf', sizeBytes: 2 * MB }, 'Factura'),
    ).toEqual({ ok: true, kind: 'DOCUMENT', mimeType: 'application/pdf' });
  });

  it('acepta un .m4a declarado como audio/x-m4a sin pie', () => {
    expect(checkOutboundAttachment({ mimeType: 'audio/x-m4a', sizeBytes: MB }, '')).toEqual({
      ok: true,
      kind: 'AUDIO',
      mimeType: 'audio/mp4',
    });
  });

  it('rechaza tipos no admitidos, vacíos y demasiado grandes', () => {
    const check = (mimeType: string, sizeBytes: number) =>
      checkOutboundAttachment({ mimeType, sizeBytes }, '');
    expect(check('application/zip', MB)).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    expect(check('', MB)).toEqual({ ok: false, reason: 'UNSUPPORTED_TYPE' });
    expect(check('image/png', 0)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(check('image/png', 5 * MB + 1)).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(check('video/mp4', 16 * MB + 1)).toEqual({ ok: false, reason: 'TOO_LARGE' });
  });

  it('rechaza pie en audios y pies de más de 1024 caracteres', () => {
    expect(checkOutboundAttachment({ mimeType: 'audio/mpeg', sizeBytes: MB }, 'hola')).toEqual({
      ok: false,
      reason: 'CAPTION_NOT_ALLOWED',
    });
    expect(
      checkOutboundAttachment({ mimeType: 'image/png', sizeBytes: MB }, 'x'.repeat(1025)),
    ).toEqual({ ok: false, reason: 'CAPTION_TOO_LONG' });
  });

  it('no admite stickers salientes', () => {
    expect(checkOutboundAttachment({ mimeType: 'image/webp', sizeBytes: 1000 }, '')).toEqual({
      ok: false,
      reason: 'UNSUPPORTED_TYPE',
    });
    expect(OUTBOUND_ATTACHMENT_ACCEPT).not.toContain('image/webp');
  });
});

describe('attachmentContentPath', () => {
  it('apunta al endpoint de contenido', () => {
    expect(attachmentContentPath('0199c0de-0000-7000-8000-000000000001')).toBe(
      '/api/v1/attachments/0199c0de-0000-7000-8000-000000000001/content',
    );
  });
});

describe('MessageSchema.attachment', () => {
  const base = {
    id: '0199c0de-0000-7000-8000-000000000001',
    sequence: 1,
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    text: '',
    status: 'RECEIVED',
    sender: null,
    failureReason: null,
    createdAt: '2026-10-13T10:00:00.000Z',
  };

  it('vale null si no viene', () => {
    expect(MessageSchema.parse(base).attachment).toBeNull();
  });

  it('acepta un adjunto', () => {
    const attachment = {
      id: '0199c0de-0000-7000-8000-000000000002',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: null,
      sizeBytes: 1234,
      voice: false,
      status: 'READY',
    };
    expect(MessageSchema.parse({ ...base, attachment }).attachment).toEqual(attachment);
  });
});
```

- [ ] **Paso 2: ejecutar y ver que falla**

Ejecuta: `pnpm --filter @omnidesk/contracts exec vitest run src/attachments.spec.ts`
Esperado: FAIL con `Failed to resolve import "./attachments"`.

- [ ] **Paso 3: implementar**

`packages/contracts/src/attachments.ts`:

```ts
import { z } from 'zod';

export const AttachmentKindSchema = z.enum(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER']);
export type AttachmentKind = z.infer<typeof AttachmentKindSchema>;

/** `PENDING`: entrante aún sin descargar de WhatsApp. */
export const AttachmentStatusSchema = z.enum(['PENDING', 'READY', 'FAILED']);
export type AttachmentStatus = z.infer<typeof AttachmentStatusSchema>;

export const AttachmentSchema = z.object({
  id: z.uuid(),
  kind: AttachmentKindSchema,
  mimeType: z.string(),
  fileName: z.string().nullable(),
  sizeBytes: z.int().min(0).nullable(),
  /** Nota de voz grabada en WhatsApp. */
  voice: z.boolean(),
  status: AttachmentStatusSchema,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

const MB = 1024 * 1024;

/** Tope del multipart: el mayor de `OUTBOUND_ATTACHMENT_TYPES`. */
export const MAX_OUTBOUND_ATTACHMENT_BYTES = 16 * MB;
/** Pie de foto máximo de WhatsApp Cloud API. */
export const MAX_ATTACHMENT_CAPTION_LENGTH = 1024;

/** Tipos que el agente puede enviar (WhatsApp Cloud API). El documento se acota a 16 MB, Meta admite 100. */
export const OUTBOUND_ATTACHMENT_TYPES: Readonly<
  Record<string, { kind: AttachmentKind; maxBytes: number }>
> = {
  'image/jpeg': { kind: 'IMAGE', maxBytes: 5 * MB },
  'image/png': { kind: 'IMAGE', maxBytes: 5 * MB },
  'video/mp4': { kind: 'VIDEO', maxBytes: 16 * MB },
  'video/3gpp': { kind: 'VIDEO', maxBytes: 16 * MB },
  'audio/aac': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/amr': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/mpeg': { kind: 'AUDIO', maxBytes: 16 * MB },
  'audio/mp4': { kind: 'AUDIO', maxBytes: 16 * MB },
  /** Meta solo acepta ogg con códec opus. */
  'audio/ogg': { kind: 'AUDIO', maxBytes: 16 * MB },
  'application/pdf': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'text/plain': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/msword': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
  'application/vnd.ms-excel': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
  'application/vnd.ms-powerpoint': { kind: 'DOCUMENT', maxBytes: 16 * MB },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    kind: 'DOCUMENT',
    maxBytes: 16 * MB,
  },
};

/** `accept` del input de archivo de la web. */
export const OUTBOUND_ATTACHMENT_ACCEPT = [
  ...Object.keys(OUTBOUND_ATTACHMENT_TYPES),
  '.m4a',
].join(',');

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'image/jpg': 'image/jpeg',
};

/** Minúsculas, sin parámetros (`; codecs=…`) y con los alias que declaran algunos navegadores. */
export function normalizeMimeType(mimeType: string): string {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_ALIASES[base] ?? base;
}

export type OutboundAttachmentRejection =
  | 'UNSUPPORTED_TYPE'
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'CAPTION_NOT_ALLOWED'
  | 'CAPTION_TOO_LONG';

export type OutboundAttachmentCheck =
  | { ok: true; kind: AttachmentKind; mimeType: string }
  | { ok: false; reason: OutboundAttachmentRejection };

/** Misma validación en la web (antes de subir) y en el API (autoritativa). */
export function checkOutboundAttachment(
  file: { mimeType: string; sizeBytes: number },
  caption: string,
): OutboundAttachmentCheck {
  const mimeType = normalizeMimeType(file.mimeType);
  const rule = Object.hasOwn(OUTBOUND_ATTACHMENT_TYPES, mimeType)
    ? OUTBOUND_ATTACHMENT_TYPES[mimeType]
    : undefined;
  if (!rule) return { ok: false, reason: 'UNSUPPORTED_TYPE' };
  if (file.sizeBytes === 0) return { ok: false, reason: 'EMPTY' };
  if (file.sizeBytes > rule.maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  if (caption.length > MAX_ATTACHMENT_CAPTION_LENGTH)
    return { ok: false, reason: 'CAPTION_TOO_LONG' };
  if (rule.kind === 'AUDIO' && caption.trim()) return { ok: false, reason: 'CAPTION_NOT_ALLOWED' };
  return { ok: true, kind: rule.kind, mimeType };
}

/** Ruta del contenido, relativa a la base del API. */
export function attachmentContentPath(attachmentId: string): string {
  return `/api/v1/attachments/${encodeURIComponent(attachmentId)}/content`;
}

/** Campos de texto de `POST /api/v1/conversations/:id/messages/attachments`; el archivo va en `file`. */
export const SendAgentAttachmentFieldsSchema = z.object({
  /** uuid generado en la web: un reintento por error de red no duplica el mensaje. */
  clientMessageId: z.uuid(),
  caption: z.string().max(MAX_ATTACHMENT_CAPTION_LENGTH).default(''),
});
export type SendAgentAttachmentFields = z.infer<typeof SendAgentAttachmentFieldsSchema>;
```

En `packages/contracts/src/index.ts`, añade en orden alfabético:

```ts
export * from './attachments';
```

En `packages/contracts/src/conversations.ts`, importa `AttachmentSchema` y añade el campo a `MessageSchema`, después de `failureReason`:

```ts
import { AttachmentSchema } from './attachments';
```

```ts
  /** Motivo del último fallo de envío; `null` si no falló. */
  failureReason: z.string().nullable(),
  /** Archivo del mensaje; el texto es su pie (puede ser vacío). */
  attachment: AttachmentSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
```

- [ ] **Paso 4: ejecutar y ver que pasa**

Ejecuta: `pnpm --filter @omnidesk/contracts exec vitest run && pnpm --filter @omnidesk/contracts typecheck && pnpm --filter @omnidesk/contracts build`
Esperado: PASS; build sin errores.

- [ ] **Paso 5: commit**

```bash
git add packages/contracts/src/attachments.ts packages/contracts/src/attachments.spec.ts packages/contracts/src/index.ts packages/contracts/src/conversations.ts
git commit -m "feat(contracts): add attachment schemas and outbound validation"
```

---

### Tarea 2: Modelo de datos y dominio del mensaje con adjunto

**Archivos:**
- Modificar: `apps/api/prisma/schema.prisma` (enums nuevos, `Tenant`, `Message`, modelo nuevo)
- Crear: `apps/api/prisma/migrations/20261016000000_message_attachments/migration.sql`
- Modificar: `apps/api/src/modules/conversations/domain/message.ts`
- Crear: `apps/api/src/modules/conversations/domain/message.spec.ts`
- Modificar: `apps/api/src/modules/conversations/infrastructure/prisma-conversation.repository.ts:28-41,92-120`
- Modificar: `apps/api/src/modules/conversations/testing/in-memory.ts:113-133`
- Modificar: `apps/api/src/modules/conversations/application/register-inbound-message.use-case.ts`
- Modificar: `apps/api/src/modules/conversations/application/send-agent-message.use-case.ts:18-22,72`
- Crear: `apps/api/src/modules/conversations/infrastructure/http/message.mapper.ts`
- Modificar: `apps/api/src/modules/conversations/infrastructure/http/conversations.controller.ts:85-96`
- Modificar: `apps/api/src/modules/conversations/conversations.module.ts` (exportar `SendAgentMessageUseCase`)
- Prueba: `apps/api/src/modules/conversations/application/use-cases.spec.ts`

**Interfaces:**
- Consume: `AttachmentKind`, `AttachmentStatus` de la tarea 1.
- Produce:
  - `MessageAttachment { id; kind; mimeType; fileName: string|null; sizeBytes: number|null; voice: boolean; status; storageKey: string|null }`.
  - `Message.attachment: MessageAttachment | null`.
  - `NewAttachment { kind; mimeType; status; fileName?; sizeBytes?; voice?; sha256?; providerMediaId?; storageKey? }`.
  - `NewMessage.attachment?: NewAttachment`.
  - `previewSource(message: Pick<NewMessage,'text'|'attachment'>): string`.
  - `customerMessage(text, externalId, providerTimestamp, attachment?)` y `agentMessage(text, senderMemberId, clientMessageId, attachment?)`.
  - `InboundAttachment { kind; mimeType; providerMediaId; sha256?; fileName?; voice? }`, `InboundMessageInput.attachment?` e `InboundMessageResult.attachmentId: string | null`.
  - `SendAgentMessageInput.attachment?: NewAttachment`.
  - `toMessageDto(message: Message): MessageResponse` exportada desde `message.mapper.ts`.

- [ ] **Paso 1: escribir las pruebas que fallan**

`apps/api/src/modules/conversations/domain/message.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { previewSource } from './message';

describe('previewSource', () => {
  it('sin adjunto devuelve el texto', () => {
    expect(previewSource({ text: 'Hola' })).toBe('Hola');
  });

  it('nombra el tipo y añade el pie', () => {
    expect(
      previewSource({ text: 'Mi factura', attachment: { kind: 'IMAGE', mimeType: 'image/jpeg', status: 'PENDING' } }),
    ).toBe('Foto · Mi factura');
  });

  it('usa el nombre del documento y distingue la nota de voz', () => {
    expect(
      previewSource({
        text: '',
        attachment: { kind: 'DOCUMENT', mimeType: 'application/pdf', status: 'PENDING', fileName: 'cotización.pdf' },
      }),
    ).toBe('Documento: cotización.pdf');
    expect(
      previewSource({ text: '', attachment: { kind: 'AUDIO', mimeType: 'audio/ogg', status: 'PENDING', voice: true } }),
    ).toBe('Nota de voz');
  });
});
```

Al final del `describe('RegisterInboundMessageUseCase', …)` de `use-cases.spec.ts`, añade:

```ts
  it('registra un adjunto PENDING, devuelve attachmentId y la vista previa nombra el tipo', async () => {
    const result = await useCase.execute(integration, {
      ...inbound('m-img'),
      text: '',
      attachment: { kind: 'IMAGE', mimeType: 'image/jpeg', providerMediaId: 'media-1', sha256: 'abc=' },
    });

    const stored = conversations.messages[0]!;
    expect(stored.attachment).toMatchObject({ kind: 'IMAGE', status: 'PENDING' });
    expect(result.attachmentId).toBe(stored.attachment!.id);
    expect(conversations.conversations[0]!.lastMessagePreview).toBe('Foto');
  });

  it('un mensaje de texto devuelve attachmentId null', async () => {
    expect((await useCase.execute(integration, inbound('m-txt'))).attachmentId).toBeNull();
  });
```

- [ ] **Paso 2: ejecutar y ver que fallan**

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/conversations`
Esperado: FAIL (`previewSource` no existe; `attachment` no existe en `NewMessage`).

- [ ] **Paso 3: esquema Prisma y migración**

En `apps/api/prisma/schema.prisma`, añade después de `enum MessageStatus`:

```prisma
enum AttachmentKind {
  IMAGE
  DOCUMENT
  AUDIO
  VIDEO
  STICKER
}

enum AttachmentStatus {
  /// Entrante aún sin descargar de WhatsApp.
  PENDING
  READY
  FAILED
}
```

En `model Tenant`, añade `attachments   MessageAttachment[]` debajo de `messages`. En `model Message`, añade `attachment   MessageAttachment?` debajo de la relación `sender`. Al final del archivo:

```prisma
/// Archivo de un mensaje (SPEC 14). Los bytes viven en el bucket (`storageKey`), nunca en Postgres.
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

`apps/api/prisma/migrations/20261016000000_message_attachments/migration.sql`:

```sql
-- SPEC 14: adjuntos de mensajes.
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER');
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "sha256" TEXT,
    "provider_media_id" TEXT,
    "storage_key" TEXT,
    "status" "AttachmentStatus" NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_attachments_message_id_key" ON "message_attachments"("message_id");
CREATE INDEX "message_attachments_tenant_id_idx" ON "message_attachments"("tenant_id");

ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Comprueba que el SQL coincide con lo que generaría Prisma: `docker compose exec api pnpm --filter @omnidesk/api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`. Tras aplicar la migración, la salida debe estar vacía. Si SPEC 12 (RLS) ya está aplicado, añade la política de `tenant_id` igual que en el resto de tablas.

Aplica y regenera: `docker compose exec api pnpm --filter @omnidesk/api exec prisma migrate deploy && pnpm --filter @omnidesk/api db:generate`.

- [ ] **Paso 4: dominio**

En `apps/api/src/modules/conversations/domain/message.ts`, añade arriba:

```ts
import type { AttachmentKind, AttachmentStatus } from '@omnidesk/contracts';

/** Archivo del mensaje, tal como se lee. */
export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  voice: boolean;
  status: AttachmentStatus;
  /** Clave del objeto en el bucket; null mientras está PENDING. */
  storageKey: string | null;
}

/** Archivo de un mensaje nuevo. */
export interface NewAttachment {
  kind: AttachmentKind;
  mimeType: string;
  status: AttachmentStatus;
  fileName?: string;
  sizeBytes?: number;
  voice?: boolean;
  sha256?: string;
  providerMediaId?: string;
  storageKey?: string;
}
```

En `Message`, después de `failureReason`, añade `attachment: MessageAttachment | null;`. En `NewMessage`, añade `attachment?: NewAttachment;`. Sustituye `customerMessage` y `agentMessage` y añade `previewSource`:

```ts
/** Mensaje del cliente: entrante y ya recibido. Con adjunto, `text` es el pie (puede ser vacío). */
export function customerMessage(
  text: string,
  externalId: string,
  providerTimestamp: Date,
  attachment?: NewAttachment,
): NewMessage {
  return {
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    status: 'RECEIVED',
    text,
    externalId,
    providerTimestamp,
    ...(attachment && { attachment }),
  };
}

/** Mensaje del agente: saliente y pendiente de que el proveedor lo confirme. */
export function agentMessage(
  text: string,
  senderMemberId: string,
  clientMessageId: string,
  attachment?: NewAttachment,
): NewMessage {
  return {
    direction: 'OUTBOUND',
    senderType: 'AGENT',
    status: 'PENDING',
    text,
    senderMemberId,
    clientMessageId,
    ...(attachment && { attachment }),
  };
}

const KIND_LABELS: Record<AttachmentKind, string> = {
  IMAGE: 'Foto',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  STICKER: 'Sticker',
  DOCUMENT: 'Documento',
};

/** Texto del que sale la vista previa de la lista: el texto o, con adjunto, su tipo y el pie. */
export function previewSource(message: Pick<NewMessage, 'text' | 'attachment'>): string {
  const { attachment, text } = message;
  if (!attachment) return text;
  const label = attachment.voice
    ? 'Nota de voz'
    : attachment.kind === 'DOCUMENT' && attachment.fileName
      ? `Documento: ${attachment.fileName}`
      : KIND_LABELS[attachment.kind];
  return text.trim() ? `${label} · ${text}` : label;
}
```

- [ ] **Paso 5: repositorios**

En `prisma-conversation.repository.ts`, añade a `messageSelect`, después de `sender`:

```ts
  attachment: {
    select: {
      id: true,
      kind: true,
      mimeType: true,
      fileName: true,
      sizeBytes: true,
      voice: true,
      status: true,
      storageKey: true,
    },
  },
```

Sustituye `appendMessage` (importa `previewSource` de `../domain/message`):

```ts
  async appendMessage(conversation: Conversation, message: NewMessage, at: Date): Promise<Message> {
    const summary = appendMessage(conversation, previewSource(message), at);
    // El incremento lo hace la base (UPDATE … RETURNING): dos mensajes simultáneos nunca comparten sequence.
    const { lastSequence } = await this.db.client.conversation.update({
      where: { id: conversation.id },
      data: {
        lastSequence: { increment: 1 },
        lastMessageAt: summary.lastMessageAt,
        lastMessagePreview: summary.lastMessagePreview,
      },
      select: { lastSequence: true },
    });

    const { attachment, ...fields } = message;
    try {
      return await this.db.client.message.create({
        data: {
          tenantId: conversation.tenantId,
          channelId: conversation.channelId,
          conversationId: conversation.id,
          sequence: lastSequence,
          createdAt: at,
          ...fields,
          ...(attachment && {
            attachment: { create: { tenantId: conversation.tenantId, ...attachment } },
          }),
        },
        select: messageSelect,
      });
    } catch (error) {
      rethrowUniqueConflict(error);
    }
  }
```

En `testing/in-memory.ts`, sustituye `appendMessage` de `InMemoryConversations` (importa `previewSource`):

```ts
  async appendMessage(conversation: Conversation, message: NewMessage, at: Date) {
    Object.assign(conversation, appendMessage(conversation, previewSource(message), at));
    const { attachment, ...fields } = message;
    const stored = {
      ...fields,
      id: randomUUID(),
      channelId: conversation.channelId,
      conversationId: conversation.id,
      sequence: conversation.lastSequence,
      externalId: message.externalId ?? null,
      sender: message.senderMemberId
        ? {
            id: message.senderMemberId,
            displayName: this.memberNames.get(message.senderMemberId) ?? message.senderMemberId,
          }
        : null,
      failureReason: null,
      attachment: attachment
        ? {
            id: randomUUID(),
            kind: attachment.kind,
            mimeType: attachment.mimeType,
            fileName: attachment.fileName ?? null,
            sizeBytes: attachment.sizeBytes ?? null,
            voice: attachment.voice ?? false,
            status: attachment.status,
            storageKey: attachment.storageKey ?? null,
          }
        : null,
      createdAt: at,
    };
    this.messages.push(stored);
    return stored;
  }
```

Cambia el tipo de `messages` a `(Message & Omit<NewMessage, 'externalId' | 'attachment'>)[]`.

- [ ] **Paso 6: casos de uso**

En `register-inbound-message.use-case.ts`:

```ts
import type { AttachmentKind } from '@omnidesk/contracts';
import { customerMessage, previewSource } from '../domain/message';

/** Media de WhatsApp aún sin descargar. */
export interface InboundAttachment {
  kind: AttachmentKind;
  mimeType: string;
  providerMediaId: string;
  sha256?: string;
  fileName?: string;
  voice?: boolean;
}

export interface InboundMessageInput {
  externalMessageId: string;
  from: { externalId: string; displayName?: string };
  /** Con adjunto, su pie (puede ser vacío). */
  text: string;
  sentAt: Date;
  attachment?: InboundAttachment;
}

export interface InboundMessageResult {
  conversationId: string;
  messageId: string;
  /** Adjunto que hay que descargar; null sin adjunto. */
  attachmentId: string | null;
  aiAllowed: boolean;
  controlVersion: number;
  duplicate: boolean;
}
```

En `register()`, sustituye desde `const now = new Date();` hasta el `appendMessage`, y pasa el id del adjunto a `toResult` en los dos `return`:

```ts
    if (existing) {
      // …igual que hoy…
      return toResult(conversation, existing.id, existing.attachment?.id ?? null, true);
    }
    // …contacto igual que hoy…
    const now = new Date();
    const newMessage = customerMessage(
      input.text,
      input.externalMessageId,
      input.sentAt,
      input.attachment && { ...input.attachment, status: 'PENDING' },
    );
    const conversation = await this.conversationFor(
      integration,
      contact.id,
      previewSource(newMessage),
      now,
    );
    const message = await this.conversations.appendMessage(conversation, newMessage, now);
    // …enqueueConversationChanged igual que hoy…
    return toResult(conversation, message.id, message.attachment?.id ?? null, false);
```

Renombra el parámetro `text` de `conversationFor` a `preview`. Ya llega calculado: `preview: toPreview(preview)`. Actualiza `toResult`:

```ts
function toResult(
  conversation: Conversation,
  messageId: string,
  attachmentId: string | null,
  duplicate: boolean,
): InboundMessageResult {
  return {
    conversationId: conversation.id,
    messageId,
    attachmentId,
    aiAllowed: isAiActive(conversation),
    controlVersion: conversation.controlVersion,
    duplicate,
  };
}
```

Revisa `apps/api/src/modules/integrations/infrastructure/http/inbound-messages.controller.ts`. Si devuelve el `InboundMessageResult` tal cual, devuelve solo los cinco campos del contrato (`conversationId`, `messageId`, `aiAllowed`, `controlVersion`, `duplicate`), para no cambiar la respuesta del legado N8N.

En `send-agent-message.use-case.ts`:

```ts
import { agentMessage, type Message, type NewAttachment } from '../domain/message';

export interface SendAgentMessageInput {
  conversationId: string;
  /** Con adjunto, su pie (puede ser vacío). */
  text: string;
  clientMessageId: string;
  /** Ya guardado en el bucket (`storageKey`) y en `READY`. */
  attachment?: NewAttachment;
}
```

y en `send()`: `agentMessage(input.text, actor.memberId, input.clientMessageId, input.attachment)`.

En `conversations.module.ts`, añade `SendAgentMessageUseCase` a `exports`.

- [ ] **Paso 7: DTO**

`apps/api/src/modules/conversations/infrastructure/http/message.mapper.ts`:

```ts
import type { Message as MessageResponse } from '@omnidesk/contracts';
import type { Message } from '../../domain/message';

/** La clave del bucket no sale del API: la web pide el contenido a `/attachments/:id/content`. */
export function toMessageDto(message: Message): MessageResponse {
  const { attachment } = message;
  return {
    id: message.id,
    sequence: message.sequence,
    direction: message.direction,
    senderType: message.senderType,
    text: message.text,
    status: message.status,
    sender: message.sender,
    failureReason: message.failureReason,
    attachment: attachment && {
      id: attachment.id,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      voice: attachment.voice,
      status: attachment.status,
    },
    createdAt: message.createdAt.toISOString(),
  };
}
```

En `conversations.controller.ts`, borra la función local `toMessageDto` e impórtala desde `./message.mapper`. Quita el import de `Message as MessageResponse` si ya no se usa.

- [ ] **Paso 8: ejecutar y ver que pasa**

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run && pnpm --filter @omnidesk/api typecheck`
Esperado: PASS. Si algún `.spec.ts` construye un `Message` a mano, añade `attachment: null`.

- [ ] **Paso 9: commit**

```bash
git add apps/api/prisma apps/api/src/modules/conversations apps/api/src/modules/integrations
git commit -m "feat(api): add message attachments model and preview"
```

---

### Tarea 3: Almacenamiento (puerto, MinIO y memoria)

**Archivos:**
- Modificar: `apps/api/src/shared/config/env.ts` y `env.spec.ts`
- Modificar: `apps/api/test/support/test-env.ts`
- Crear: `apps/api/src/modules/attachments/application/ports/attachment-storage.ts`
- Crear: `apps/api/src/modules/attachments/domain/byte-range.ts`
- Crear: `apps/api/src/modules/attachments/infrastructure/memory-attachment-storage.ts` (+ `.spec.ts`)
- Crear: `apps/api/src/modules/attachments/infrastructure/s3-attachment-storage.ts`
- Crear: `apps/api/test/s3-storage.e2e-spec.ts`
- Modificar: `docker-compose.yml`, `.env.example`
- Dependencia: `pnpm --filter @omnidesk/api add @aws-sdk/client-s3@3.1151.0`

**Interfaces:**
- Produce:
  - `AttachmentStorage { put(key, body: Buffer | Readable, { contentType, contentLength }): Promise<void>; get(key, range?: ByteRange): Promise<StoredObject>; delete(key): Promise<void> }` y `StoredObject { body: Readable }`.
  - Token `ATTACHMENT_STORAGE`; `attachmentStorageKey(tenantId, attachmentId)`, `outboundStorageKey(tenantId, token)`; `ByteRange { start; end }`.
  - `MemoryAttachmentStorage` y `S3AttachmentStorage` (con `ensureBucket()`).
  - Variables `ATTACHMENT_STORAGE_DRIVER`, `S3_*` y `ATTACHMENT_INBOUND_MAX_BYTES`.

- [ ] **Paso 1: pruebas que fallan**

Añade a `env.spec.ts`:

```ts
describe('parseEnv — adjuntos', () => {
  const s3 = {
    ATTACHMENT_STORAGE_DRIVER: 's3',
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY_ID: 'omnidesk',
    S3_SECRET_ACCESS_KEY: 'omnidesk-dev-secret',
  };

  it('usa memoria y 25 MB por defecto', () => {
    const env = parseEnv(valid);
    expect(env.ATTACHMENT_STORAGE_DRIVER).toBe('memory');
    expect(env.ATTACHMENT_INBOUND_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(env.S3_BUCKET).toBe('omnidesk-attachments');
  });

  it('con s3 exige endpoint y credenciales', () => {
    expect(() => parseEnv({ ...valid, ATTACHMENT_STORAGE_DRIVER: 's3' })).toThrowError(
      /S3_ENDPOINT/,
    );
    expect(parseEnv({ ...valid, ...s3 }).S3_ENDPOINT).toBe('http://minio:9000');
  });

  it('en producción exige s3', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      CHANNEL_SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
      SESSION_COOKIE_SECURE: 'true',
    };
    expect(() => parseEnv(production)).toThrowError(/ATTACHMENT_STORAGE_DRIVER/);
    expect(() => parseEnv({ ...production, ...s3 })).not.toThrow();
  });
});
```

Si `parseEnv(production)` con `s3` falla por otra variable obligatoria de producción añadida en SPEC 10, añádela al objeto `production`, igual que en las pruebas de producción existentes del mismo archivo.

`apps/api/src/modules/attachments/infrastructure/memory-attachment-storage.spec.ts`:

```ts
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { MemoryAttachmentStorage } from './memory-attachment-storage';

describe('MemoryAttachmentStorage', () => {
  it('guarda un stream, lo lee entero o por rango y lo borra', async () => {
    const storage = new MemoryAttachmentStorage();
    await storage.put('k', Readable.from([Buffer.from('hola '), Buffer.from('mundo')]), {
      contentType: 'text/plain',
      contentLength: 10,
    });

    expect((await buffer((await storage.get('k')).body)).toString()).toBe('hola mundo');
    expect((await buffer((await storage.get('k', { start: 5, end: 9 })).body)).toString()).toBe(
      'mundo',
    );
    await storage.delete('k');
    await expect(storage.get('k')).rejects.toThrow(/no existe/);
  });

  it('rechaza un cuerpo cuyo tamaño no coincide, como S3', async () => {
    const storage = new MemoryAttachmentStorage();
    await expect(
      storage.put('k', Buffer.from('abc'), { contentType: 'text/plain', contentLength: 5 }),
    ).rejects.toThrow(/tamaño/);
  });
});
```

- [ ] **Paso 2: ejecutar y ver que fallan**

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/shared/config src/modules/attachments`
Esperado: FAIL.

- [ ] **Paso 3: variables de entorno**

En `EnvSchema` (`env.ts`), después de `SESSION_COOKIE_SECURE`:

```ts
    /** Dónde se guardan los adjuntos: `s3` (MinIO u otro S3) o `memory` (pruebas; se pierden al reiniciar). */
    ATTACHMENT_STORAGE_DRIVER: z.enum(['memory', 's3']).default('memory'),
    S3_ENDPOINT: z.preprocess((value) => value || undefined, z.url().optional()),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('omnidesk-attachments'),
    S3_ACCESS_KEY_ID: z.preprocess((value) => value || undefined, z.string().min(3).optional()),
    S3_SECRET_ACCESS_KEY: z.preprocess(
      (value) => value || undefined,
      z.string().min(8).optional(),
    ),
    /** Tope de un adjunto entrante: los mayores quedan FAILED sin descargarse. */
    ATTACHMENT_INBOUND_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),
```

En `superRefine`, **antes** de `if (!env.DEMO_MODE) return;`:

```ts
    if (env.ATTACHMENT_STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Es obligatoria con ATTACHMENT_STORAGE_DRIVER=s3',
          });
        }
      }
    }
    if (env.NODE_ENV === 'production' && env.ATTACHMENT_STORAGE_DRIVER !== 's3') {
      ctx.addIssue({
        code: 'custom',
        path: ['ATTACHMENT_STORAGE_DRIVER'],
        message: 'Debe ser s3 con NODE_ENV=production',
      });
    }
```

En `test/support/test-env.ts`, dentro de `parseEnv({ … })` y antes de `...overrides`, añade `ATTACHMENT_STORAGE_DRIVER: 'memory',`. Así un `.env` con `s3` (endpoint `minio`, inalcanzable desde el host) no rompe la suite.

- [ ] **Paso 4: puerto y adaptadores**

`apps/api/src/modules/attachments/domain/byte-range.ts` (la función `parseRange` llega en la tarea 6):

```ts
/** Rango de bytes inclusivo, como en `Content-Range`. */
export interface ByteRange {
  start: number;
  end: number;
}
```

`apps/api/src/modules/attachments/application/ports/attachment-storage.ts`:

```ts
import type { Readable } from 'node:stream';
import type { ByteRange } from '../../domain/byte-range';

export interface StoredObject {
  body: Readable;
}

/** Bucket privado de los adjuntos: los bytes solo salen por el API. */
export interface AttachmentStorage {
  /** `contentLength` es obligatorio: S3 no acepta un stream sin tamaño. */
  put(
    key: string,
    body: Buffer | Readable,
    options: { contentType: string; contentLength: number },
  ): Promise<void>;
  get(key: string, range?: ByteRange): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

export const ATTACHMENT_STORAGE = Symbol('ATTACHMENT_STORAGE');

/** Entrantes: determinista, un reintento de la descarga sobrescribe el mismo objeto. */
export function attachmentStorageKey(tenantId: string, attachmentId: string): string {
  return `tenants/${tenantId}/attachments/${attachmentId}`;
}

/** Salientes: se suben antes de que exista la fila. */
export function outboundStorageKey(tenantId: string, token: string): string {
  return `tenants/${tenantId}/attachments/out-${token}`;
}
```

`apps/api/src/modules/attachments/infrastructure/memory-attachment-storage.ts`:

```ts
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { AttachmentStorage, StoredObject } from '../application/ports/attachment-storage';
import type { ByteRange } from '../../domain/byte-range';

/** Solo pruebas y desarrollo sin MinIO: el contenido se pierde al reiniciar. */
export class MemoryAttachmentStorage implements AttachmentStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(
    key: string,
    body: Buffer | Readable,
    options: { contentType: string; contentLength: number },
  ): Promise<void> {
    const bytes = Buffer.isBuffer(body) ? body : await buffer(body);
    if (bytes.length !== options.contentLength)
      throw new Error(`El tamaño no coincide: ${bytes.length} ≠ ${options.contentLength}`);
    this.objects.set(key, bytes);
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject> {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`El objeto ${key} no existe`);
    return { body: Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]) };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
```

Instala el SDK: `pnpm --filter @omnidesk/api add @aws-sdk/client-s3@3.1151.0`.

`apps/api/src/modules/attachments/infrastructure/s3-attachment-storage.ts`:

```ts
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../../../shared/config/env';
import type { AttachmentStorage, StoredObject } from '../application/ports/attachment-storage';
import type { ByteRange } from '../../domain/byte-range';

/** MinIO (o cualquier S3). `forcePathStyle`: MinIO no resuelve buckets como subdominio. */
export class S3AttachmentStorage implements AttachmentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: Env) {
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
      throw new Error('Faltan S3_ENDPOINT, S3_ACCESS_KEY_ID o S3_SECRET_ACCESS_KEY');
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  /** Crea el bucket privado si no existe (primer arranque). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(
    key: string,
    body: Buffer | Readable,
    options: { contentType: string; contentLength: number },
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: options.contentLength,
      }),
    );
  }

  async get(key: string, range?: ByteRange): Promise<StoredObject> {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range && { Range: `bytes=${range.start}-${range.end}` }),
      }),
    );
    if (!(result.Body instanceof Readable)) throw new Error(`Objeto ${key} sin cuerpo`);
    return { body: result.Body };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
```

`apps/api/test/s3-storage.e2e-spec.ts`: prueba real contra MinIO. Solo corre si exportas `S3_E2E_ENDPOINT=http://localhost:9050`.

```ts
import { randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { S3AttachmentStorage } from '../src/modules/attachments/infrastructure/s3-attachment-storage';
import { testEnv } from './support/test-env';

describe.runIf(process.env.S3_E2E_ENDPOINT)('S3AttachmentStorage contra MinIO (e2e)', () => {
  it('crea el bucket, guarda, lee por rango y borra', async () => {
    const storage = new S3AttachmentStorage(
      testEnv({
        ATTACHMENT_STORAGE_DRIVER: 's3',
        S3_ENDPOINT: process.env.S3_E2E_ENDPOINT!,
        S3_BUCKET: 'omnidesk-e2e',
        S3_ACCESS_KEY_ID: process.env.MINIO_ROOT_USER ?? 'omnidesk',
        S3_SECRET_ACCESS_KEY: process.env.MINIO_ROOT_PASSWORD ?? 'omnidesk-dev-secret',
      }),
    );
    await storage.ensureBucket();
    const key = `e2e/${randomUUID()}`;
    await storage.put(key, Buffer.from('hola mundo'), {
      contentType: 'text/plain',
      contentLength: 10,
    });

    expect((await buffer((await storage.get(key, { start: 5, end: 9 })).body)).toString()).toBe(
      'mundo',
    );
    await storage.delete(key);
  });
});
```

- [ ] **Paso 5: MinIO en el compose local**

En `docker-compose.yml`, añade el servicio y el volumen:

```yaml
  # Adjuntos (SPEC 14). S3 en el host: http://localhost:9050; consola: http://localhost:9051.
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    command: server /data --console-address :9001
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-omnidesk}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-omnidesk-dev-secret}
    ports:
      - '${MINIO_HOST_PORT:-9050}:9000'
      - '${MINIO_CONSOLE_HOST_PORT:-9051}:9001'
    volumes:
      - miniodata:/data
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 5s
      timeout: 3s
      retries: 10
```

En `api.depends_on`, añade `minio: { condition: service_healthy }`. En `volumes:`, añade `miniodata:`.

En `.env.example`, después del bloque del API:

```bash
# --- Adjuntos (SPEC 14) ---
# s3 = MinIO del compose. memory = en memoria (se pierde al reiniciar; solo pruebas).
ATTACHMENT_STORAGE_DRIVER=s3
MINIO_ROOT_USER=omnidesk
MINIO_ROOT_PASSWORD=omnidesk-dev-secret
# S3 en el host (9000 suele estar ocupado por otro MinIO) y consola web.
MINIO_HOST_PORT=9050
MINIO_CONSOLE_HOST_PORT=9051
# "minio" es el hostname del servicio dentro de Docker Compose.
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=omnidesk-attachments
S3_ACCESS_KEY_ID=omnidesk
S3_SECRET_ACCESS_KEY=omnidesk-dev-secret
# Tope de un adjunto entrante (25 MB).
ATTACHMENT_INBOUND_MAX_BYTES=26214400
```

Copia el mismo bloque a tu `.env` local, que no está en git.

- [ ] **Paso 6: ejecutar y ver que pasa**

```bash
pnpm --filter @omnidesk/api exec vitest run src/shared/config src/modules/attachments
docker compose up -d minio && S3_E2E_ENDPOINT=http://localhost:9050 pnpm --filter @omnidesk/api exec vitest run --config vitest.e2e.config.ts test/s3-storage.e2e-spec.ts
```

Esperado: PASS en ambos. Si `mc ready local` no existe en la imagen, cambia el healthcheck por `['CMD-SHELL', 'curl -fs http://localhost:9000/minio/health/live || exit 1']` y comprueba con `docker compose ps` que `minio` sale `healthy`.

- [ ] **Paso 7: commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/shared/config apps/api/test apps/api/src/modules/attachments docker-compose.yml .env.example
git commit -m "feat(api): add attachment storage port with MinIO and memory adapters"
```

---

### Tarea 4: Recibir adjuntos en el webhook

**Archivos:**
- Modificar: `apps/api/src/modules/whatsapp/whatsapp-protocol.ts:30-117`
- Modificar: `apps/api/src/modules/whatsapp/whatsapp-protocol.spec.ts`
- Modificar: `apps/api/src/modules/whatsapp/whatsapp-webhook.controller.ts:81-105`
- Crear: `apps/api/src/modules/attachments/application/enqueue-attachment-download.ts`
- Modificar: `apps/api/src/shared/application/outbox.port.ts`
- Crear: `apps/api/test/attachments.e2e-spec.ts`

**Interfaces:**
- Consume: `InboundAttachment` e `InboundMessageResult.attachmentId` de la tarea 2.
- Produce:
  - `WhatsAppEvent` inbound con `attachment?` y `unsupportedType?: string`.
  - `ATTACHMENT_DOWNLOAD_REQUESTED = 'attachment.download_requested'`, `AttachmentDownloadPayloadSchema` (`{ attachmentId: uuid, channelId: uuid }`) y `enqueueAttachmentDownload(outbox, tenantId, payload)`.

- [ ] **Paso 1: pruebas unitarias que fallan**

Añade a `whatsapp-protocol.spec.ts`:

```ts
describe('parseWhatsAppEvents — media', () => {
  const phoneId = '1322469280958506';
  const envelope = (message: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '28766413009634402',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '573001167601', phone_number_id: phoneId },
              contacts: [{ profile: { name: 'Gossio', username: 'gossio' }, wa_id: '573008018173' }],
              messages: [
                { from: '573008018173', id: 'wamid.X', timestamp: '1791947497', ...message },
              ],
            },
          },
        ],
      },
    ],
  });

  it('traduce la imagen real que se perdía (sin caption)', () => {
    const [event] = parseWhatsAppEvents(
      envelope({
        type: 'image',
        image: {
          mime_type: 'image/jpeg',
          sha256: 'OB6bxx08SvN4XPAqCi9Nh6oFkKjraEfFM73xLTIN78A=',
          id: '1501404631865040',
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1',
        },
      }),
      phoneId,
    );
    expect(event).toMatchObject({
      kind: 'inbound',
      externalMessageId: 'wamid.X',
      from: { externalId: '+573008018173', displayName: 'Gossio' },
      text: '',
      attachment: {
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        providerMediaId: '1501404631865040',
        sha256: 'OB6bxx08SvN4XPAqCi9Nh6oFkKjraEfFM73xLTIN78A=',
      },
    });
  });

  it('documento con nombre y pie, nota de voz, video y sticker', () => {
    const parse = (type: string, media: Record<string, unknown>) =>
      parseWhatsAppEvents(envelope({ type, [type]: { id: 'm1', mime_type: 'x/y', ...media } }), phoneId)[0];
    expect(parse('document', { filename: 'cotización.pdf', caption: 'Te paso' })).toMatchObject({
      text: 'Te paso',
      attachment: { kind: 'DOCUMENT', fileName: 'cotización.pdf' },
    });
    expect(parse('audio', { voice: true })).toMatchObject({ attachment: { kind: 'AUDIO', voice: true } });
    expect(parse('video', {})).toMatchObject({ attachment: { kind: 'VIDEO' } });
    expect(parse('sticker', {})).toMatchObject({ attachment: { kind: 'STICKER' } });
  });

  it('registra los tipos no soportados como texto e ignora las reacciones', () => {
    const [location] = parseWhatsAppEvents(
      envelope({ type: 'location', location: { latitude: 4.6, longitude: -74 } }),
      phoneId,
    );
    expect(location).toMatchObject({
      text: '[Mensaje de WhatsApp no soportado: location]',
      unsupportedType: 'location',
    });
    expect(location).not.toHaveProperty('attachment');
    expect(
      parseWhatsAppEvents(envelope({ type: 'reaction', reaction: { message_id: 'w', emoji: '👍' } }), phoneId),
    ).toEqual([]);
  });

  it('no confunde un tipo con propiedades del prototipo', () => {
    const [event] = parseWhatsAppEvents(envelope({ type: 'constructor' }), phoneId);
    expect(event).toMatchObject({ unsupportedType: 'constructor' });
  });
});
```

- [ ] **Paso 2: ejecutar y ver que falla**

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/whatsapp/whatsapp-protocol.spec.ts`
Esperado: FAIL; la imagen devuelve `[]`.

- [ ] **Paso 3: parser**

En `whatsapp-protocol.ts`, sustituye `TextMessage` por:

```ts
const From = z
  .string()
  .transform((v) => (v.startsWith('+') ? v : `+${v}`))
  .pipe(E164Schema);
const BaseMessage = z.object({
  id: z.string().min(1).max(200),
  from: From,
  timestamp: Timestamp,
  type: z.string().min(1).max(50),
});
const TextBody = z.object({ body: MessageTextSchema });
const Media = z.object({
  id: z.string().min(1),
  mime_type: z.string().min(1).max(255),
  sha256: z.string().optional(),
  caption: z.string().max(4096).optional(),
  filename: z.string().max(255).optional(),
  voice: z.boolean().optional(),
});
const MEDIA_KINDS = {
  image: 'IMAGE',
  document: 'DOCUMENT',
  audio: 'AUDIO',
  video: 'VIDEO',
  sticker: 'STICKER',
} as const satisfies Record<string, AttachmentKind>;
type MediaType = keyof typeof MEDIA_KINDS;
```

(importa `type AttachmentKind` de `@omnidesk/contracts`). Cambia el tipo del evento:

```ts
export type WhatsAppEvent =
  | ({ kind: 'inbound'; unsupportedType?: string } & InboundMessageInput)
  | {
      kind: 'status';
      providerMessageId: string;
      messageId?: string;
      status: DeliveryStatus;
      occurredAt: Date;
    };
```

Añade el traductor de un mensaje:

```ts
type ParsedInbound = Omit<InboundMessageInput, 'from'> & { from: string; unsupportedType?: string };

/** `null` = no es un mensaje nuevo del cliente (reacción) o el sobre es inválido. */
function parseInboundMessage(raw: unknown): ParsedInbound | null {
  const base = BaseMessage.safeParse(raw);
  if (!base.success) return null;
  const { id, from, timestamp, type } = base.data;
  const common = { externalMessageId: id, from, sentAt: timestamp };
  const record = raw as Record<string, unknown>;
  if (type === 'text') {
    const text = TextBody.safeParse(record.text);
    return text.success ? { ...common, text: text.data.body } : null;
  }
  if (type === 'reaction') return null;
  if (Object.hasOwn(MEDIA_KINDS, type)) {
    const media = Media.safeParse(record[type]);
    if (media.success) {
      const m = media.data;
      return {
        ...common,
        text: m.caption ?? '',
        attachment: {
          kind: MEDIA_KINDS[type as MediaType],
          mimeType: m.mime_type,
          providerMediaId: m.id,
          ...(m.sha256 !== undefined && { sha256: m.sha256 }),
          ...(m.filename !== undefined && { fileName: m.filename }),
          ...(m.voice === true && { voice: true }),
        },
      };
    }
  }
  return { ...common, text: `[Mensaje de WhatsApp no soportado: ${type}]`, unsupportedType: type };
}
```

En `parseWhatsAppEvents`, sustituye el bucle de `value.messages`:

```ts
      for (const raw of asList(value.messages)) {
        const message = parseInboundMessage(raw);
        if (!message) continue;
        const contact = contacts.success
          ? contacts.data.find((item) => `+${item.wa_id}` === message.from)
          : undefined;
        events.push({
          kind: 'inbound',
          ...message,
          from: {
            externalId: message.from,
            ...(contact?.profile && { displayName: contact.profile.name }),
          },
        });
      }
```

- [ ] **Paso 4: encolar la descarga**

`apps/api/src/modules/attachments/application/enqueue-attachment-download.ts`:

```ts
import { z } from 'zod';
import type { OutboxPort } from '../../../shared/application/outbox.port';

export const ATTACHMENT_DOWNLOAD_REQUESTED = 'attachment.download_requested';

export const AttachmentDownloadPayloadSchema = z.object({
  attachmentId: z.uuid(),
  channelId: z.uuid(),
});
export type AttachmentDownloadPayload = z.infer<typeof AttachmentDownloadPayloadSchema>;

/** Encola la descarga del media de WhatsApp, en la transacción activa. */
export function enqueueAttachmentDownload(
  outbox: OutboxPort,
  tenantId: string,
  payload: AttachmentDownloadPayload,
): Promise<void> {
  return outbox.enqueue({ tenantId, type: ATTACHMENT_DOWNLOAD_REQUESTED, payload });
}
```

En `outbox.port.ts`, añade `| 'attachment.download_requested'` al tipo `type`.

En `whatsapp-webhook.controller.ts`, sustituye la rama `inbound` del bucle:

```ts
      if (event.kind === 'inbound') {
        // Los adjuntos y los no soportados quedan para atención humana: nunca van a la IA.
        const aiEligible = !event.attachment && !event.unsupportedType;
        await this.inbound.execute(integration, event, async (result) => {
          if (result.duplicate) return;
          if (result.attachmentId)
            await enqueueAttachmentDownload(this.outbox, channel.tenantId, {
              attachmentId: result.attachmentId,
              channelId: id,
            });
          if (
            aiEligible &&
            result.aiAllowed &&
            channel.aiEnabled &&
            channel.webhookUrl &&
            channel.hmacSecretEnc
          ) {
            await this.outbox.enqueue({
              tenantId: channel.tenantId,
              type: 'ai.reply_requested',
              payload: {
                channelId: id,
                messageId: result.messageId,
                conversationId: result.conversationId,
                controlVersion: result.controlVersion,
                from: event.from,
                text: event.text,
              },
            });
          }
        });
      } else {
```

- [ ] **Paso 5: e2e que falla, después pasa**

`apps/api/test/attachments.e2e-spec.ts`. Las tareas 5 a 7 añaden casos a este mismo archivo.

```ts
import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxDispatcher } from '../src/modules/realtime/infrastructure/outbox-dispatcher';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { sessionFor, WEB_ORIGIN } from './support/session';
import { testEnv } from './support/test-env';

const appSecret = 'meta-app-secret-for-e2e';
const verifyToken = 'meta-verify-token-for-e2e-123456';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const sha256B64 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

describe('Adjuntos de WhatsApp (e2e)', () => {
  let app: NestExpressApplication;
  let db: PrismaService;
  let cookie: string;
  let tenantId: string;
  let ownerMemberId: string;
  let channelId: string;
  let externalId: string;
  const http = () => request(app.getHttpServer());

  const envelope = (message: Record<string, unknown>, wamid = `wamid.${randomUUID()}`) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: externalId },
              contacts: [{ wa_id: '573001234567', profile: { name: 'Ana' } }],
              messages: [
                {
                  id: wamid,
                  from: '573001234567',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const post = (body: unknown) => {
    const raw = JSON.stringify(body);
    return http()
      .post(`/api/v1/integrations/whatsapp/${channelId}`)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}`)
      .send(raw);
  };
  const imageMessage = (caption?: string) => ({
    type: 'image',
    image: { id: 'media-1', mime_type: 'image/jpeg', sha256: sha256B64(jpeg), ...(caption && { caption }) },
  });
  const enableAi = async () => {
    const manage = (path: string) => http().patch(path).set('Cookie', cookie).set('Origin', WEB_ORIGIN);
    await manage(`/api/v1/channels/${channelId}`).send({ webhookUrl: 'https://n8n.example.com/webhook/ai' }).expect(200);
    await http().post(`/api/v1/channels/${channelId}/credentials`).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send({}).expect(201);
    await manage(`/api/v1/channels/${channelId}/whatsapp`).send({ aiEnabled: true }).expect(200);
  };
  const countEvents = (type: string) => db.outboxEvent.count({ where: { tenantId, type } });

  beforeAll(async () => {
    const env = testEnv();
    const module = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
    app = module.createNestApplication<NestExpressApplication>({ rawBody: true, bufferLogs: true });
    configureApp(app, env);
    await app.init();
    await app.get(OutboxDispatcher).onModuleDestroy();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    const tenant = await db.tenant.create({ data: { name: 'Adjuntos', slug: `att-${randomUUID()}` } });
    tenantId = tenant.id;
    const user = await db.user.create({ data: { email: `${randomUUID()}@test.local`, displayName: 'Owner' } });
    ownerMemberId = (
      await db.tenantMember.create({
        data: { tenantId, userId: user.id, email: user.email, displayName: 'Owner', role: 'OWNER' },
      })
    ).id;
    cookie = await sessionFor(app, user.id, tenantId);
    externalId = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    channelId = (
      await http()
        .post('/api/v1/channels')
        .set('Cookie', cookie)
        .set('Origin', WEB_ORIGIN)
        .send({ name: 'Ventas', phoneNumber: '+573009999999', externalId, provider: 'WHATSAPP_CLOUD' })
        .expect(201)
    ).body.id;
    await http()
      .patch(`/api/v1/channels/${channelId}/whatsapp`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ accessToken: 'meta-access-token', appSecret, verifyToken })
      .expect(200);
  });
  afterEach(async () => {
    await db.outboxEvent.updateMany({ where: { tenantId, publishedAt: null }, data: { publishedAt: new Date() } });
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('registra la imagen PENDING con su pie, encola la descarga y no llama a la IA', async () => {
    await enableAi();
    await post(envelope(imageMessage('Mi factura'))).expect(200);

    const message = await db.message.findFirstOrThrow({ where: { tenantId }, include: { attachment: true } });
    expect(message.text).toBe('Mi factura');
    expect(message.attachment).toMatchObject({ kind: 'IMAGE', status: 'PENDING', providerMediaId: 'media-1' });
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    expect(conversation.lastMessagePreview).toBe('Foto · Mi factura');
    expect(await countEvents('attachment.download_requested')).toBe(1);
    expect(await countEvents('ai.reply_requested')).toBe(0);
  });

  it('no duplica el mensaje ni la descarga si Meta repite el webhook', async () => {
    const body = envelope(imageMessage(), 'wamid.repetido');
    await post(body).expect(200);
    await post(body).expect(200);

    expect(await db.message.count({ where: { tenantId } })).toBe(1);
    expect(await countEvents('attachment.download_requested')).toBe(1);
  });

  it('un tipo no soportado queda como texto, sin IA ni descarga; una reacción no crea mensajes', async () => {
    await enableAi();
    await post(envelope({ type: 'location', location: { latitude: 4.6, longitude: -74 } })).expect(200);
    await post(envelope({ type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } })).expect(200);

    const messages = await db.message.findMany({ where: { tenantId } });
    expect(messages.map((m) => m.text)).toEqual(['[Mensaje de WhatsApp no soportado: location]']);
    expect(await countEvents('ai.reply_requested')).toBe(0);
    expect(await countEvents('attachment.download_requested')).toBe(0);
  });
});
```

Ejecuta: `pnpm --filter @omnidesk/api test:e2e -- test/attachments.e2e-spec.ts test/whatsapp.e2e-spec.ts`
Esperado: PASS. Las pruebas existentes de WhatsApp siguen en verde.

- [ ] **Paso 6: commit**

```bash
git add apps/api/src/modules/whatsapp apps/api/src/modules/attachments apps/api/src/shared/application/outbox.port.ts apps/api/test/attachments.e2e-spec.ts
git commit -m "feat(whatsapp): register inbound media and unsupported types instead of dropping them"
```

---

### Tarea 5: Descargar el media de Graph a MinIO

**Archivos:**
- Crear: `apps/api/src/modules/attachments/application/ports/attachment.repository.ts`
- Crear: `apps/api/src/modules/attachments/infrastructure/prisma-attachment.repository.ts`
- Crear: `apps/api/src/modules/attachments/domain/attachment-errors.ts`
- Crear: `apps/api/src/modules/attachments/testing/in-memory.ts`
- Crear: `apps/api/src/modules/attachments/attachments.module.ts`
- Crear: `apps/api/src/modules/whatsapp/attachment-download-worker.ts` (+ `.spec.ts`)
- Modificar: `apps/api/src/modules/whatsapp/whatsapp.module.ts`
- Crear: `apps/api/src/modules/realtime/application/ports/attachment-downloader.ts`
- Modificar: `apps/api/src/modules/realtime/infrastructure/outbox-dispatcher.ts` (+ `.spec.ts`)
- Modificar: `apps/api/src/modules/realtime/realtime.module.ts`
- Modificar: `apps/api/src/app.module.ts`
- Prueba: `apps/api/test/attachments.e2e-spec.ts`

**Interfaces:**
- Consume: `AttachmentStorage`, `attachmentStorageKey` (tarea 3); `AttachmentDownloadPayloadSchema`, `ATTACHMENT_DOWNLOAD_REQUESTED` (tarea 4).
- Produce:
  - `AttachmentRecord { id; tenantId; conversationId; kind; mimeType; fileName; sizeBytes; status; storageKey; providerMediaId; sha256 }`.
  - `AttachmentRepository { findById(tenantId, id); markReady(id, { storageKey, sizeBytes }); markFailed(id, reason) }` y el token `ATTACHMENT_REPOSITORY`.
  - `PermanentDownloadError`.
  - `AttachmentDownloader { process(tenantId, payload); fail(tenantId, payload, reason) }`, con el token `ATTACHMENT_DOWNLOADER` y su implementación `AttachmentDownloadWorker`.
  - `matchesSha256(digest: Buffer, expected: string): boolean`.
  - `AttachmentsModule`, que exporta `ATTACHMENT_STORAGE` y `ATTACHMENT_REPOSITORY`.

- [ ] **Paso 1: prueba unitaria del worker (falla)**

`apps/api/src/modules/attachments/testing/in-memory.ts`:

```ts
import type { AttachmentRecord, AttachmentRepository } from '../application/ports/attachment.repository';

export class InMemoryAttachments implements AttachmentRepository {
  readonly rows = new Map<string, AttachmentRecord & { failureReason: string | null }>();

  add(row: AttachmentRecord) {
    this.rows.set(row.id, { ...row, failureReason: null });
  }

  async findById(tenantId: string, id: string) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async markReady(id: string, update: { storageKey: string; sizeBytes: number }) {
    Object.assign(this.rows.get(id)!, { status: 'READY', ...update, failureReason: null });
  }

  async markFailed(id: string, reason: string) {
    Object.assign(this.rows.get(id)!, { status: 'FAILED', failureReason: reason });
  }
}
```

`apps/api/src/modules/whatsapp/attachment-download-worker.spec.ts`:

```ts
import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../shared/config/env';
import { attachmentStorageKey } from '../attachments/application/ports/attachment-storage';
import { PermanentDownloadError } from '../attachments/domain/attachment-errors';
import { MemoryAttachmentStorage } from '../attachments/infrastructure/memory-attachment-storage';
import { InMemoryAttachments } from '../attachments/testing/in-memory';
import { InMemoryOutbox } from '../conversations/testing/in-memory';
import { AttachmentDownloadWorker, matchesSha256 } from './attachment-download-worker';
import type { WhatsAppSettings } from './whatsapp-settings';

const tenantId = '0199c0de-0000-7000-8000-0000000000a1';
const channelId = '0199c0de-0000-7000-8000-0000000000c1';
const attachmentId = '0199c0de-0000-7000-8000-0000000000f1';
const bytes = Buffer.from('contenido-de-la-foto');
const b64 = createHash('sha256').update(bytes).digest('base64');

describe('AttachmentDownloadWorker', () => {
  let attachments: InMemoryAttachments;
  let storage: MemoryAttachmentStorage;
  let outbox: InMemoryOutbox;
  let worker: AttachmentDownloadWorker;
  const fetchMock = vi.fn();

  beforeEach(() => {
    attachments = new InMemoryAttachments();
    storage = new MemoryAttachmentStorage();
    outbox = new InMemoryOutbox();
    attachments.add({
      id: attachmentId,
      tenantId,
      conversationId: '0199c0de-0000-7000-8000-0000000000b1',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: null,
      sizeBytes: null,
      status: 'PENDING',
      storageKey: null,
      providerMediaId: 'media-1',
      sha256: b64,
    });
    const settings = {
      find: async () => ({ id: channelId, whatsappAccessTokenEnc: Buffer.from('enc') }),
    } as unknown as WhatsAppSettings;
    const cipher = { encrypt: () => Buffer.alloc(0), decrypt: () => 'token-meta' };
    const env = parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ATTACHMENT_INBOUND_MAX_BYTES: '100' });
    worker = new AttachmentDownloadWorker(settings, cipher, env, attachments, storage, outbox);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const graph = (fileSize = bytes.length, body: Buffer = bytes) => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', sha256: b64, file_size: fileSize }))
      .mockResolvedValueOnce(new Response(new Uint8Array(body)));
  };

  it('descarga con el Bearer, guarda en el bucket, marca READY y avisa a la web', async () => {
    graph();
    await worker.process(tenantId, { attachmentId, channelId });

    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/media-1$/);
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('Bearer token-meta');
    const row = attachments.rows.get(attachmentId)!;
    expect(row).toMatchObject({ status: 'READY', sizeBytes: bytes.length });
    expect(await buffer((await storage.get(row.storageKey!)).body)).toEqual(bytes);
    expect(outbox.events).toMatchObject([{ type: 'conversation.changed', payload: { reason: 'message' } }]);
  });

  it('lanza un error reintentable si el sha256 no coincide y no deja el objeto', async () => {
    // Mismo tamaño (20 bytes) y contenido distinto.
    graph(bytes.length, Buffer.from('contenido-distinto!!'));
    const error = await worker.process(tenantId, { attachmentId, channelId }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentDownloadError);
    expect((error as Error).message).toMatch(/sha256/);
    expect(attachments.rows.get(attachmentId)!.status).toBe('PENDING');
    await expect(storage.get(attachmentStorageKey(tenantId, attachmentId))).rejects.toThrow(/no existe/);
  });

  it('un archivo mayor que el tope es un error permanente', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ url: 'https://x', file_size: 101 }));
    await expect(worker.process(tenantId, { attachmentId, channelId })).rejects.toBeInstanceOf(PermanentDownloadError);
  });

  it('fail marca FAILED con el motivo y avisa a la web', async () => {
    await worker.fail(tenantId, { attachmentId, channelId }, 'TOO_LARGE');
    expect(attachments.rows.get(attachmentId)).toMatchObject({ status: 'FAILED', failureReason: 'TOO_LARGE' });
    expect(outbox.events).toHaveLength(1);
  });

  it('acepta el sha256 en base64 o en hex', () => {
    const digest = createHash('sha256').update(bytes).digest();
    expect(matchesSha256(digest, b64)).toBe(true);
    expect(matchesSha256(digest, digest.toString('hex').toUpperCase())).toBe(true);
    expect(matchesSha256(digest, 'otro')).toBe(false);
  });
});
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/whatsapp/attachment-download-worker.spec.ts`
Esperado: FAIL; el módulo no existe.

- [ ] **Paso 2: repositorio, errores y módulo**

`apps/api/src/modules/attachments/application/ports/attachment.repository.ts`:

```ts
import type { AttachmentKind, AttachmentStatus } from '@omnidesk/contracts';

export interface AttachmentRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  kind: AttachmentKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number | null;
  status: AttachmentStatus;
  storageKey: string | null;
  providerMediaId: string | null;
  sha256: string | null;
}

export interface AttachmentRepository {
  findById(tenantId: string, id: string): Promise<AttachmentRecord | null>;
  markReady(id: string, update: { storageKey: string; sizeBytes: number }): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

export const ATTACHMENT_REPOSITORY = Symbol('ATTACHMENT_REPOSITORY');
```

`apps/api/src/modules/attachments/infrastructure/prisma-attachment.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaDb } from '../../../shared/infrastructure/prisma/prisma-transaction-runner';
import type { AttachmentRecord, AttachmentRepository } from '../application/ports/attachment.repository';

@Injectable()
export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: PrismaDb) {}

  async findById(tenantId: string, id: string): Promise<AttachmentRecord | null> {
    const row = await this.db.client.messageAttachment.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        kind: true,
        mimeType: true,
        fileName: true,
        sizeBytes: true,
        status: true,
        storageKey: true,
        providerMediaId: true,
        sha256: true,
        message: { select: { conversationId: true } },
      },
    });
    if (!row) return null;
    const { message, ...attachment } = row;
    return { ...attachment, conversationId: message.conversationId };
  }

  async markReady(id: string, update: { storageKey: string; sizeBytes: number }): Promise<void> {
    await this.db.client.messageAttachment.update({
      where: { id },
      data: { status: 'READY', ...update, failureReason: null },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.db.client.messageAttachment.update({
      where: { id },
      data: { status: 'FAILED', failureReason: reason },
    });
  }
}
```

`apps/api/src/modules/attachments/domain/attachment-errors.ts`:

```ts
/** Reintentar no sirve (sin token, archivo demasiado grande, media borrado): el adjunto pasa a FAILED. */
export class PermanentDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDownloadError';
  }
}
```

`apps/api/src/modules/attachments/attachments.module.ts` (las tareas 6 y 7 añaden controladores y casos de uso):

```ts
import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../shared/config/env';
import { ATTACHMENT_REPOSITORY } from './application/ports/attachment.repository';
import { ATTACHMENT_STORAGE } from './application/ports/attachment-storage';
import { MemoryAttachmentStorage } from './infrastructure/memory-attachment-storage';
import { PrismaAttachmentRepository } from './infrastructure/prisma-attachment.repository';
import { S3AttachmentStorage } from './infrastructure/s3-attachment-storage';

@Module({
  providers: [
    {
      provide: ATTACHMENT_STORAGE,
      inject: [ENV],
      useFactory: async (env: Env) => {
        if (env.ATTACHMENT_STORAGE_DRIVER === 'memory') return new MemoryAttachmentStorage();
        const storage = new S3AttachmentStorage(env);
        await storage.ensureBucket();
        return storage;
      },
    },
    { provide: ATTACHMENT_REPOSITORY, useClass: PrismaAttachmentRepository },
  ],
  exports: [ATTACHMENT_STORAGE, ATTACHMENT_REPOSITORY],
})
export class AttachmentsModule {}
```

Añade `AttachmentsModule` a los `imports` de `AppModule`, después de `ConversationsModule`.

- [ ] **Paso 3: worker**

`apps/api/src/modules/realtime/application/ports/attachment-downloader.ts`:

```ts
/** Descarga del media entrante (`attachment.download_requested`), con los reintentos del Outbox. */
export interface AttachmentDownloader {
  /** Lanza `PermanentDownloadError` si reintentar no sirve; cualquier otro error se reintenta. */
  process(tenantId: string, payload: unknown): Promise<void>;
  /** Agotados los intentos o ante un error permanente: el adjunto pasa a FAILED. */
  fail(tenantId: string, payload: unknown, reason: string): Promise<void>;
}

export const ATTACHMENT_DOWNLOADER = Symbol('ATTACHMENT_DOWNLOADER');
```

`apps/api/src/modules/whatsapp/attachment-download-worker.ts`:

```ts
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { OUTBOX_PORT, type OutboxPort } from '../../shared/application/outbox.port';
import { ENV, type Env } from '../../shared/config/env';
import { AttachmentDownloadPayloadSchema } from '../attachments/application/enqueue-attachment-download';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRepository,
} from '../attachments/application/ports/attachment.repository';
import {
  ATTACHMENT_STORAGE,
  attachmentStorageKey,
  type AttachmentStorage,
} from '../attachments/application/ports/attachment-storage';
import { PermanentDownloadError } from '../attachments/domain/attachment-errors';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import { enqueueConversationChanged } from '../conversations/application/enqueue-conversation-changed';
import type { AttachmentDownloader } from '../realtime/application/ports/attachment-downloader';
import { WhatsAppSettings } from './whatsapp-settings';

const MediaInfo = z.object({
  url: z.url(),
  sha256: z.string().optional(),
  file_size: z.coerce.number().int().min(0),
});

/** Meta da el sha256 en base64 en el webhook; se acepta también hex. */
export function matchesSha256(digest: Buffer, expected: string): boolean {
  return expected === digest.toString('base64') || expected.toLowerCase() === digest.toString('hex');
}

/**
 * Graph → bucket. La URL del media caduca a los 5 min: cada intento la pide de nuevo con el media id.
 * Corre dentro de la transacción del Outbox (20 s): de ahí los timeouts de 5 y 12 s.
 */
@Injectable()
export class AttachmentDownloadWorker implements AttachmentDownloader {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(ENV) private readonly env: Env,
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
  ) {}

  async process(tenantId: string, raw: unknown): Promise<void> {
    const { attachmentId, channelId } = AttachmentDownloadPayloadSchema.parse(raw);
    const attachment = await this.attachments.findById(tenantId, attachmentId);
    if (!attachment || attachment.status !== 'PENDING') return;
    if (!attachment.providerMediaId) throw new PermanentDownloadError('sin media id');
    const channel = await this.settings.find(channelId, tenantId);
    if (!channel?.whatsappAccessTokenEnc)
      throw new PermanentDownloadError('falta access token de WhatsApp');
    const authorization = `Bearer ${this.cipher.decrypt(channel.whatsappAccessTokenEnc)}`;

    const meta = await fetch(
      `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(attachment.providerMediaId)}`,
      { headers: { authorization }, redirect: 'error', signal: AbortSignal.timeout(5_000) },
    );
    if (meta.status === 404) throw new PermanentDownloadError('el media ya no existe en WhatsApp');
    if (!meta.ok) throw new Error(`WhatsApp media HTTP ${meta.status}`);
    const info = MediaInfo.parse(await meta.json());
    if (info.file_size > this.env.ATTACHMENT_INBOUND_MAX_BYTES)
      throw new PermanentDownloadError(`TOO_LARGE: ${info.file_size} bytes`);

    const file = await fetch(info.url, {
      headers: { authorization },
      signal: AbortSignal.timeout(12_000),
    });
    if (!file.ok || !file.body) throw new Error(`WhatsApp media HTTP ${file.status}`);
    const hash = createHash('sha256');
    const body = Readable.fromWeb(file.body as WebReadableStream).pipe(
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          hash.update(chunk);
          done(null, chunk);
        },
      }),
    );
    const key = attachmentStorageKey(tenantId, attachment.id);
    await this.storage.put(key, body, {
      contentType: attachment.mimeType,
      contentLength: info.file_size,
    });
    const expected = attachment.sha256 ?? info.sha256;
    if (expected && !matchesSha256(hash.digest(), expected)) {
      await this.storage.delete(key);
      throw new Error('el sha256 no coincide');
    }
    await this.attachments.markReady(attachment.id, { storageKey: key, sizeBytes: info.file_size });
    await enqueueConversationChanged(this.outbox, tenantId, attachment.conversationId, 'message', new Date());
  }

  async fail(tenantId: string, raw: unknown, reason: string): Promise<void> {
    const { attachmentId } = AttachmentDownloadPayloadSchema.parse(raw);
    const attachment = await this.attachments.findById(tenantId, attachmentId);
    if (!attachment || attachment.status !== 'PENDING') return;
    await this.attachments.markFailed(attachment.id, reason.slice(0, 500));
    await enqueueConversationChanged(this.outbox, tenantId, attachment.conversationId, 'message', new Date());
  }
}
```

En `whatsapp.module.ts`, añade `AttachmentsModule` a `imports` y `AttachmentDownloadWorker` a `providers` y a `exports`.

- [ ] **Paso 4: Outbox con reintentos y FAILED**

Prueba nueva en `outbox-dispatcher.spec.ts`. Añade este doble debajo de `FakeSender`:

```ts
class FakeDownloader implements AttachmentDownloader {
  calls = 0;
  error: Error | null = null;
  readonly failed: { payload: unknown; reason: string }[] = [];

  async process() {
    this.calls += 1;
    if (this.error) throw this.error;
  }

  async fail(_tenantId: string, payload: unknown, reason: string) {
    this.failed.push({ payload, reason });
  }
}
```

(importa `AttachmentDownloader` de `../application/ports/attachment-downloader` y `PermanentDownloadError` de `../../attachments/domain/attachment-errors`). Al final del `describe('OutboxDispatcher')`:

```ts
  describe('attachment.download_requested', () => {
    let downloader: FakeDownloader;
    const downloadEvent = () =>
      store.add({
        type: 'attachment.download_requested',
        payload: {
          attachmentId: '0199c0de-0000-7000-8000-0000000000f1',
          channelId: '0199c0de-0000-7000-8000-0000000000c1',
        },
      });

    beforeEach(() => {
      downloader = new FakeDownloader();
      dispatcher = new OutboxDispatcher(noTransaction, store, publisher, sender, undefined, downloader);
    });

    it('descarga y cierra el evento', async () => {
      const event = downloadEvent();
      expect(await dispatcher.tick(T0)).toBe(1);
      expect(downloader.calls).toBe(1);
      expect(event.publishedAt).toEqual(T0);
    });

    it('un error transitorio se reintenta 5 veces y después marca FAILED', async () => {
      const event = downloadEvent();
      downloader.error = new Error('Graph caído');
      let now = T0;
      for (let call = 0; call <= SEND_MAX_RETRIES; call += 1) {
        await dispatcher.tick(now);
        now = event.nextAttemptAt;
      }
      expect(downloader.calls).toBe(6);
      expect(downloader.failed).toEqual([{ payload: event.payload, reason: 'Graph caído' }]);
      expect(event.publishedAt).not.toBeNull();
    });

    it('un error permanente marca FAILED sin reintentar', async () => {
      const event = downloadEvent();
      downloader.error = new PermanentDownloadError('TOO_LARGE: 99 bytes');
      await dispatcher.tick(T0);
      expect(downloader.calls).toBe(1);
      expect(downloader.failed).toHaveLength(1);
      expect(event.publishedAt).toEqual(T0);
    });
  });
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/realtime`
Esperado: FAIL.

En `outbox-dispatcher.ts`, añade el constructor opcional y los imports:

```ts
import { ATTACHMENT_DOWNLOAD_REQUESTED } from '../../attachments/application/enqueue-attachment-download';
import { PermanentDownloadError } from '../../attachments/domain/attachment-errors';
import {
  ATTACHMENT_DOWNLOADER,
  type AttachmentDownloader,
} from '../application/ports/attachment-downloader';
```

```ts
    @Optional() private readonly ai?: AiReplyWorker,
    @Optional() @Inject(ATTACHMENT_DOWNLOADER) private readonly downloads?: AttachmentDownloader,
  ) {}
```

En `dispatch()`, dentro del `catch` y antes de la rama de `MESSAGE_SEND_REQUESTED`:

```ts
      if (event.type === ATTACHMENT_DOWNLOAD_REQUESTED)
        return this.failDownload(event, message, error instanceof PermanentDownloadError, now);
```

En `handle()`:

```ts
      case ATTACHMENT_DOWNLOAD_REQUESTED:
        if (!this.downloads) throw new Error('Worker de adjuntos no disponible');
        await this.downloads.process(event.tenantId, event.payload);
        return;
```

Y el método nuevo:

```ts
  /** Mismo backoff que los envíos (1 a 16 s); un error permanente no se reintenta. */
  private async failDownload(
    event: PendingOutboxEvent,
    reason: string,
    permanent: boolean,
    now: Date,
  ): Promise<boolean> {
    if (!permanent && event.attempts < SEND_MAX_RETRIES) {
      const attempts = event.attempts + 1;
      this.logger.warn(`Outbox ${event.id}: descarga fallida (reintento ${attempts}): ${reason}`);
      await this.store.scheduleRetry(event.id, {
        attempts,
        error: reason,
        at: new Date(now.getTime() + 2 ** (attempts - 1) * 1000),
      });
      return false;
    }
    this.logger.warn(`Outbox ${event.id}: descarga abandonada: ${reason}`);
    await this.downloads?.fail(event.tenantId, event.payload, reason);
    await this.store.markPublished(event.id, now, reason);
    return false;
  }
```

En `realtime.module.ts`, añade el provider (importa `AttachmentDownloadWorker` y `ATTACHMENT_DOWNLOADER`):

```ts
    { provide: ATTACHMENT_DOWNLOADER, useExisting: AttachmentDownloadWorker },
```

- [ ] **Paso 5: e2e de la descarga**

Añade a `attachments.e2e-spec.ts` (importa `AttachmentDownloadWorker`):

```ts
  const stubGraphDownload = (bytes: Buffer) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('graph.facebook.com')
          ? Response.json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', sha256: sha256B64(bytes), file_size: bytes.length })
          : new Response(new Uint8Array(bytes)),
      ),
    );
  const downloadPending = async () => {
    const event = await db.outboxEvent.findFirstOrThrow({ where: { tenantId, type: 'attachment.download_requested' } });
    await app.get(AttachmentDownloadWorker).process(tenantId, event.payload);
  };

  it('descarga la imagen, la marca READY y la timeline la expone sin storageKey', async () => {
    await post(envelope(imageMessage())).expect(200);
    stubGraphDownload(jpeg);
    await downloadPending();

    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    const timeline = await http().get(`/api/v1/conversations/${conversation.id}/timeline`).set('Cookie', cookie).expect(200);
    expect(timeline.body.items[0].attachment).toMatchObject({ kind: 'IMAGE', status: 'READY', sizeBytes: jpeg.length });
    expect(JSON.stringify(timeline.body)).not.toContain('storageKey');
  });
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run && pnpm --filter @omnidesk/api test:e2e -- test/attachments.e2e-spec.ts`
Esperado: PASS.

- [ ] **Paso 6: commit**

```bash
git add apps/api/src apps/api/test/attachments.e2e-spec.ts
git commit -m "feat(api): download inbound WhatsApp media to MinIO via the outbox"
```

---

### Tarea 6: Servir el contenido con permisos y `Range`

**Archivos:**
- Modificar: `apps/api/src/modules/attachments/domain/byte-range.ts` (+ `byte-range.spec.ts`)
- Crear: `apps/api/src/modules/attachments/domain/file-name.ts` (+ `file-name.spec.ts`)
- Crear: `apps/api/src/modules/attachments/application/get-attachment-content.use-case.ts`
- Crear: `apps/api/src/modules/attachments/infrastructure/http/attachments.controller.ts`
- Modificar: `apps/api/src/modules/attachments/attachments.module.ts`
- Prueba: `apps/api/test/attachments.e2e-spec.ts`

**Interfaces:**
- Consume: `AttachmentRepository` (tarea 5), `CONVERSATION_READ_MODEL.findAccess` y `can` (existentes).
- Produce:
  - `parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid'`.
  - `contentDisposition(mimeType, fileName): string`.
  - `cleanFileName(name): string` y `decodeMultipartFileName(name): string` (las usa la tarea 7).
  - `GetAttachmentContentUseCase.execute(actor, id): Promise<ReadyAttachment | null>`.
  - `GET /api/v1/attachments/:id/content`.

- [ ] **Paso 1: pruebas unitarias que fallan**

`byte-range.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRange } from './byte-range';

describe('parseRange', () => {
  it('sin cabecera o con varios rangos sirve el archivo entero', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });

  it('interpreta rangos cerrados, abiertos y de sufijo (Safari pide 0-1)', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(parseRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('marca invalid lo que no se puede satisfacer (416)', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-2', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
  });
});
```

`file-name.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cleanFileName, contentDisposition, decodeMultipartFileName } from './file-name';

describe('contentDisposition', () => {
  it('imágenes, audio y video en línea; el resto como descarga', () => {
    expect(contentDisposition('image/jpeg', null)).toBe('inline');
    expect(contentDisposition('audio/ogg', null)).toBe('inline');
    expect(contentDisposition('image/svg+xml', null)).toBe('attachment');
    expect(contentDisposition('text/html', 'x.html')).toMatch(/^attachment;/);
  });

  it('codifica el nombre UTF-8 y neutraliza comillas y saltos de línea', () => {
    expect(contentDisposition('application/pdf', 'cotización "final"\r\n.pdf')).toBe(
      `attachment; filename="cotizaci_n _final___.pdf"; filename*=UTF-8''${encodeURIComponent('cotización "final"\r\n.pdf')}`,
    );
  });
});

describe('cleanFileName / decodeMultipartFileName', () => {
  it('quita rutas y recorta a 255', () => {
    expect(cleanFileName('C:\\fotos\\..\\a.png')).toBe('a.png');
    expect(cleanFileName('x'.repeat(300))).toHaveLength(255);
    expect(cleanFileName('   ')).toBe('archivo');
  });

  it('recupera UTF-8 que busboy entregó como latin1 y no toca lo ya correcto', () => {
    const mangled = Buffer.from('cotización.pdf', 'utf8').toString('latin1');
    expect(decodeMultipartFileName(mangled)).toBe('cotización.pdf');
    expect(decodeMultipartFileName('cotización.pdf')).toBe('cotización.pdf');
  });
});
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/attachments/domain`
Esperado: FAIL.

- [ ] **Paso 2: implementar los helpers**

Añade a `byte-range.ts`:

```ts
/**
 * Un solo rango `bytes=a-b` (RFC 9110). `null`: sin cabecera, o varios rangos (se sirve entero, lo
 * permite la RFC). `'invalid'`: no satisfacible (416).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText = '', endText = ''] = match;
  if (!startText && !endText) return 'invalid';
  if (!startText) {
    const suffix = Number(endText);
    return suffix === 0 ? 'invalid' : { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1;
  return start >= size || start > end ? 'invalid' : { start, end };
}
```

`file-name.ts`:

```ts
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/)/;

/** Solo multimedia segura en línea. Un documento (incluido HTML o SVG de un cliente) siempre se descarga. */
export function contentDisposition(mimeType: string, fileName: string | null): string {
  const type = INLINE.test(mimeType) ? 'inline' : 'attachment';
  if (!fileName) return type;
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Sin rutas (`/`, `\`), sin controles y con 255 caracteres como máximo. */
export function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return base.slice(0, 255) || 'archivo';
}

/** busboy decodifica `filename` como latin1: si eran bytes UTF-8 válidos, se recuperan. */
export function decodeMultipartFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? name : decoded;
}
```

- [ ] **Paso 3: caso de uso y controlador**

`get-attachment-content.use-case.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  CONVERSATION_READ_MODEL,
  type ConversationReadModel,
} from '../../conversations/application/ports/conversation-read-model';
import { can } from '../../conversations/domain/conversation-policy';
import {
  ATTACHMENT_REPOSITORY,
  type AttachmentRecord,
  type AttachmentRepository,
} from './ports/attachment.repository';

export type ReadyAttachment = AttachmentRecord & { storageKey: string; sizeBytes: number };

@Injectable()
export class GetAttachmentContentUseCase {
  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachments: AttachmentRepository,
    @Inject(CONVERSATION_READ_MODEL) private readonly readModel: ConversationReadModel,
  ) {}

  /** `null` si no existe en el tenant, no está READY o el actor no puede ver la conversación. */
  async execute(actor: ActorContext, attachmentId: string): Promise<ReadyAttachment | null> {
    const attachment = await this.attachments.findById(actor.tenantId, attachmentId);
    if (!attachment || attachment.status !== 'READY') return null;
    const { storageKey, sizeBytes } = attachment;
    if (storageKey === null || sizeBytes === null) return null;
    const access = await this.readModel.findAccess(actor.tenantId, attachment.conversationId);
    if (!access || !can(actor, 'view', access)) return null;
    return { ...attachment, storageKey, sizeBytes };
  }
}
```

`infrastructure/http/attachments.controller.ts`:

```ts
import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { GetAttachmentContentUseCase } from '../../application/get-attachment-content.use-case';
import { ATTACHMENT_STORAGE, type AttachmentStorage } from '../../application/ports/attachment-storage';
import { parseRange } from '../../domain/byte-range';
import { contentDisposition } from '../../domain/file-name';

@ApiTags('attachments')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'attachments', version: '1' })
export class AttachmentsController {
  constructor(
    private readonly getContent: GetAttachmentContentUseCase,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  /** Mismo origen que la web: `<img>`, `<video>` y `<audio>` envían la cookie de sesión. */
  @Get(':id/content')
  @ApiNotFoundResponse({ description: 'No existe, no está listo o no puedes ver la conversación.' })
  async content(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.getContent.execute(actor, id);
    if (!attachment) throw new NotFoundException('Adjunto no encontrado');
    const size = attachment.sizeBytes;
    const range = parseRange(rangeHeader, size);
    res.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${size}`).end();
      return;
    }
    const object = await this.storage.get(attachment.storageKey, range ?? undefined);
    res.status(range ? 206 : 200).set({
      'Content-Type': attachment.mimeType,
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      'Content-Disposition': contentDisposition(attachment.mimeType, attachment.fileName),
      ...(range && { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` }),
    });
    await pipeline(object.body, res);
  }
}
```

En `attachments.module.ts`: añade `imports: [ConversationsModule, IdentityModule]`, `controllers: [AttachmentsController]` y `GetAttachmentContentUseCase` a `providers`.

- [ ] **Paso 4: e2e**

Añade a `attachments.e2e-spec.ts`:

```ts
  const readyImage = async () => {
    await post(envelope(imageMessage())).expect(200);
    stubGraphDownload(jpeg);
    await downloadPending();
    vi.unstubAllGlobals();
    return db.messageAttachment.findFirstOrThrow({ where: { tenantId } });
  };
  const binary = (req: request.Test) => req.buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });

  it('sirve el contenido con cabeceras seguras', async () => {
    const attachment = await readyImage();
    const res = await binary(http().get(`/api/v1/attachments/${attachment.id}/content`).set('Cookie', cookie)).expect(200);

    expect(res.body).toEqual(jpeg);
    expect(res.headers).toMatchObject({
      'content-type': 'image/jpeg',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
    });
  });

  it('responde 206 con Content-Range (Safari) y 416 fuera de rango', async () => {
    const attachment = await readyImage();
    const url = `/api/v1/attachments/${attachment.id}/content`;
    const partial = await binary(http().get(url).set('Cookie', cookie).set('Range', 'bytes=0-1')).expect(206);
    expect(partial.headers['content-range']).toBe(`bytes 0-1/${jpeg.length}`);
    expect(partial.headers['content-length']).toBe('2');
    expect(partial.body).toEqual(jpeg.subarray(0, 2));
    await http().get(url).set('Cookie', cookie).set('Range', `bytes=${jpeg.length}-`).expect(416);
  });

  it('404 a otra empresa, sin sesión 401 y 404 mientras está PENDING', async () => {
    const attachment = await readyImage();
    const other = await db.tenant.create({ data: { name: 'Otra', slug: `other-${randomUUID()}` } });
    const user = await db.user.create({ data: { email: `${randomUUID()}@test.local`, displayName: 'X' } });
    await db.tenantMember.create({ data: { tenantId: other.id, userId: user.id, email: user.email, displayName: 'X', role: 'OWNER' } });
    const otherCookie = await sessionFor(app, user.id, other.id);

    await http().get(`/api/v1/attachments/${attachment.id}/content`).set('Cookie', otherCookie).expect(404);
    await http().get(`/api/v1/attachments/${attachment.id}/content`).expect(401);
    await post(envelope(imageMessage())).expect(200);
    const pending = await db.messageAttachment.findFirstOrThrow({ where: { tenantId, status: 'PENDING' } });
    await http().get(`/api/v1/attachments/${pending.id}/content`).set('Cookie', cookie).expect(404);
  });
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/attachments && pnpm --filter @omnidesk/api test:e2e -- test/attachments.e2e-spec.ts`
Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/api/src/modules/attachments apps/api/test/attachments.e2e-spec.ts
git commit -m "feat(api): serve attachment content with permissions and range requests"
```

---

### Tarea 7: Endpoint multipart para enviar un adjunto

**Archivos:**
- Crear: `apps/api/src/modules/attachments/application/send-agent-attachment.use-case.ts`
- Crear: `apps/api/src/modules/attachments/infrastructure/http/conversation-attachments.controller.ts`
- Modificar: `apps/api/src/modules/attachments/attachments.module.ts`
- Dependencia: `pnpm --filter @omnidesk/api add -D @types/multer`
- Prueba: `apps/api/test/attachments.e2e-spec.ts`

**Interfaces:**
- Consume: `checkOutboundAttachment`, `SendAgentAttachmentFieldsSchema` y `MAX_OUTBOUND_ATTACHMENT_BYTES` (tarea 1); `SendAgentMessageUseCase` con `attachment?` (tarea 2); `AttachmentStorage` y `outboundStorageKey` (tarea 3); `cleanFileName` y `decodeMultipartFileName` (tarea 6); `toMessageDto` (tarea 2).
- Produce:
  - `SendAgentAttachmentUseCase.execute(actor, { conversationId, clientMessageId, caption, file: { buffer, mimeType, fileName, sizeBytes } })`, que devuelve un `SendAgentMessageResult` o `{ kind: 'invalid'; reason: OutboundAttachmentRejection }`.
  - `POST /api/v1/conversations/:id/messages/attachments`.

- [ ] **Paso 1: e2e que falla**

Añade a `attachments.e2e-spec.ts`:

```ts
  const openAssigned = async () => {
    await post(envelope({ type: 'text', text: { body: 'Hola' } })).expect(200);
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await http()
      .post(`/api/v1/conversations/${conversation.id}/assign`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ memberId: ownerMemberId, controlVersion: conversation.controlVersion })
      .expect(200);
    return conversation.id;
  };
  const upload = (conversationId: string, file: { bytes: Buffer; name: string; type: string }, fields: Record<string, string> = {}) => {
    let req = http()
      .post(`/api/v1/conversations/${conversationId}/messages/attachments`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .field('clientMessageId', fields.clientMessageId ?? randomUUID());
    if (fields.caption !== undefined) req = req.field('caption', fields.caption);
    return req.attach('file', file.bytes, { filename: file.name, contentType: file.type });
  };
  const pdf = { bytes: Buffer.from('%PDF-1.4 prueba'), name: 'cotización.pdf', type: 'application/pdf' };

  it('el agente asignado envía un PDF con pie; conserva el nombre UTF-8; es idempotente', async () => {
    const conversationId = await openAssigned();
    const clientMessageId = randomUUID();
    const first = await upload(conversationId, pdf, { clientMessageId, caption: 'Te paso la cotización' }).expect(201);

    expect(first.body).toMatchObject({
      status: 'PENDING',
      text: 'Te paso la cotización',
      attachment: { kind: 'DOCUMENT', fileName: 'cotización.pdf', status: 'READY', sizeBytes: pdf.bytes.length },
    });
    const again = await upload(conversationId, pdf, { clientMessageId }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await db.messageAttachment.count({ where: { tenantId, message: { direction: 'OUTBOUND' } } })).toBe(1);
  });

  it('valida tipo, tamaño, pie de audio y archivo ausente', async () => {
    const conversationId = await openAssigned();
    await upload(conversationId, { bytes: Buffer.from('PK'), name: 'a.zip', type: 'application/zip' }).expect(415);
    await upload(conversationId, { bytes: Buffer.alloc(5 * 1024 * 1024 + 1), name: 'g.png', type: 'image/png' }).expect(413);
    await upload(conversationId, { bytes: Buffer.alloc(17 * 1024 * 1024), name: 'v.mp4', type: 'video/mp4' }).expect(413);
    await upload(conversationId, { bytes: Buffer.from('ID3'), name: 'a.mp3', type: 'audio/mpeg' }, { caption: 'hola' }).expect(400);
    await http()
      .post(`/api/v1/conversations/${conversationId}/messages/attachments`)
      .set('Cookie', cookie)
      .set('Origin', WEB_ORIGIN)
      .field('clientMessageId', randomUUID())
      .expect(400);
  });

  it('403 si no es el agente asignado y 409 si la conversación está cerrada', async () => {
    await post(envelope({ type: 'text', text: { body: 'Hola' } })).expect(200);
    const conversation = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    await upload(conversation.id, pdf).expect(403);
    const conversationId = await openAssigned();
    const current = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    await http().post(`/api/v1/conversations/${conversationId}/close`).set('Cookie', cookie).set('Origin', WEB_ORIGIN).send({ controlVersion: current.controlVersion }).expect(200);
    await upload(conversationId, pdf).expect(409);
  });
```

Ejecuta: `pnpm --filter @omnidesk/api test:e2e -- test/attachments.e2e-spec.ts`
Esperado: FAIL con 404 (la ruta no existe).

- [ ] **Paso 2: caso de uso**

`send-agent-attachment.use-case.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { checkOutboundAttachment, type OutboundAttachmentRejection } from '@omnidesk/contracts';
import type { ActorContext } from '../../../shared/application/request-context';
import {
  SendAgentMessageUseCase,
  type SendAgentMessageResult,
} from '../../conversations/application/send-agent-message.use-case';
import { cleanFileName } from '../domain/file-name';
import {
  ATTACHMENT_STORAGE,
  outboundStorageKey,
  type AttachmentStorage,
} from './ports/attachment-storage';

export interface SendAgentAttachmentInput {
  conversationId: string;
  clientMessageId: string;
  caption: string;
  file: { buffer: Buffer; mimeType: string; fileName: string; sizeBytes: number };
}

export type SendAgentAttachmentResult =
  | SendAgentMessageResult
  | { kind: 'invalid'; reason: OutboundAttachmentRejection };

/**
 * Sube el archivo al bucket y registra el mensaje `PENDING` (el Outbox lo envía). El objeto se sube
 * antes de la transacción; si el mensaje no se crea (duplicado, permisos, error), se borra.
 */
@Injectable()
export class SendAgentAttachmentUseCase {
  constructor(
    private readonly sendMessage: SendAgentMessageUseCase,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async execute(actor: ActorContext, input: SendAgentAttachmentInput): Promise<SendAgentAttachmentResult> {
    const check = checkOutboundAttachment(
      { mimeType: input.file.mimeType, sizeBytes: input.file.sizeBytes },
      input.caption,
    );
    if (!check.ok) return { kind: 'invalid', reason: check.reason };

    const storageKey = outboundStorageKey(actor.tenantId, randomUUID());
    await this.storage.put(storageKey, input.file.buffer, {
      contentType: check.mimeType,
      contentLength: input.file.sizeBytes,
    });
    try {
      const result = await this.sendMessage.execute(actor, {
        conversationId: input.conversationId,
        text: input.caption.trim(),
        clientMessageId: input.clientMessageId,
        attachment: {
          kind: check.kind,
          mimeType: check.mimeType,
          fileName: cleanFileName(input.file.fileName),
          sizeBytes: input.file.sizeBytes,
          status: 'READY',
          storageKey,
        },
      });
      if (result.kind !== 'ok' || result.duplicate) await this.discard(storageKey);
      return result;
    } catch (error) {
      await this.discard(storageKey);
      throw error;
    }
  }

  private async discard(storageKey: string): Promise<void> {
    await this.storage.delete(storageKey).catch(() => undefined);
  }
}
```

- [ ] **Paso 3: controlador**

Instala los tipos: `pnpm --filter @omnidesk/api add -D @types/multer`.

`conversation-attachments.controller.ts`:

```ts
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Res,
  UnsupportedMediaTypeException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  MAX_OUTBOUND_ATTACHMENT_BYTES,
  SendAgentAttachmentFieldsSchema,
  type OutboundAttachmentRejection,
  type SendAgentMessageResponse,
} from '@omnidesk/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import type { ActorContext } from '../../../../shared/application/request-context';
import { OriginGuard } from '../../../../shared/infrastructure/http/origin.guard';
import { Actor } from '../../../../shared/infrastructure/http/request-context.decorators';
import { toMessageDto } from '../../../conversations/infrastructure/http/message.mapper';
import { SessionGuard } from '../../../identity/infrastructure/http/session.guard';
import { RateLimit } from '../../../ratelimit/infrastructure/http/rate-limit.decorator';
import { SendAgentAttachmentUseCase } from '../../application/send-agent-attachment.use-case';
import { decodeMultipartFileName } from '../../domain/file-name';

class SendAgentAttachmentFieldsDto extends createZodDto(SendAgentAttachmentFieldsSchema) {}

const REJECTIONS: Record<OutboundAttachmentRejection, () => Error> = {
  UNSUPPORTED_TYPE: () => new UnsupportedMediaTypeException('Tipo de archivo no admitido'),
  TOO_LARGE: () => new PayloadTooLargeException('El archivo supera el tamaño permitido'),
  EMPTY: () => new BadRequestException('El archivo está vacío'),
  CAPTION_NOT_ALLOWED: () => new BadRequestException('Los audios se envían sin texto'),
  CAPTION_TOO_LONG: () => new BadRequestException('El texto admite hasta 1024 caracteres'),
};

@ApiTags('conversations')
@UseGuards(OriginGuard, SessionGuard)
@Controller({ path: 'conversations', version: '1' })
export class ConversationAttachmentsController {
  constructor(private readonly sendAttachment: SendAgentAttachmentUseCase) {}

  /** Un archivo por mensaje; `caption` es su texto. Multer responde 413 si supera 16 MB. */
  @Post(':id/messages/attachments')
  @RateLimit('send-message')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_OUTBOUND_ATTACHMENT_BYTES, files: 1, fields: 5 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  async send(
    @Actor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: SendAgentAttachmentFieldsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SendAgentMessageResponse> {
    if (!file) throw new BadRequestException('Falta el archivo');
    const result = await this.sendAttachment.execute(actor, {
      conversationId: id,
      clientMessageId: body.clientMessageId,
      caption: body.caption,
      file: {
        buffer: file.buffer,
        mimeType: file.mimetype,
        fileName: decodeMultipartFileName(file.originalname),
        sizeBytes: file.size,
      },
    });
    switch (result.kind) {
      case 'invalid':
        throw REJECTIONS[result.reason]();
      case 'not-found':
        throw new NotFoundException('Conversación no encontrada');
      case 'forbidden':
        throw new ForbiddenException('Solo el agente asignado puede responder');
      case 'rejected':
        throw new ConflictException({ reason: result.reason });
      case 'ok':
        res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
        return toMessageDto(result.message);
    }
  }
}
```

En `attachments.module.ts`: añade `ConversationAttachmentsController` a `controllers` y `SendAgentAttachmentUseCase` a `providers`.

- [ ] **Paso 4: ejecutar y ver que pasa**

Ejecuta: `pnpm --filter @omnidesk/api test:e2e -- test/attachments.e2e-spec.ts test/human-messages.e2e-spec.ts`
Esperado: PASS. Si el 403 llega antes que el 415 por el orden de los guards, no pasa nada: los casos de la prueba están separados.

- [ ] **Paso 5: commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/attachments apps/api/test/attachments.e2e-spec.ts
git commit -m "feat(api): accept agent attachments via multipart upload"
```

---

### Tarea 8: Enviar el adjunto por WhatsApp Cloud

**Archivos:**
- Modificar: `apps/api/src/modules/messaging/application/ports/messaging-provider.port.ts`
- Modificar: `apps/api/src/modules/messaging/application/dispatch-outbound-message.use-case.ts:45-52`
- Modificar: `apps/api/src/modules/messaging/infrastructure/n8n-messaging-provider.ts` (+ `.spec.ts`)
- Modificar: `apps/api/src/modules/messaging/infrastructure/simulated-messaging-provider.spec.ts` (`attachment: null` en las peticiones)
- Modificar: `apps/api/src/modules/whatsapp/whatsapp-cloud-provider.ts`
- Crear: `apps/api/src/modules/whatsapp/whatsapp-cloud-provider.spec.ts`
- Prueba: `apps/api/test/attachments.e2e-spec.ts`

**Interfaces:**
- Consume: `Message.attachment` (tarea 2); `AttachmentStorage` (tarea 3).
- Produce:
  - `OutboundAttachment { kind: AttachmentKind; mimeType: string; fileName: string | null; storageKey: string }`.
  - `SendMessageRequest.attachment: OutboundAttachment | null`.

- [ ] **Paso 1: prueba unitaria que falla**

`whatsapp-cloud-provider.spec.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../../shared/config/env';
import { MemoryAttachmentStorage } from '../attachments/infrastructure/memory-attachment-storage';
import type { SendMessageRequest } from '../messaging/application/ports/messaging-provider.port';
import { WhatsAppCloudProvider } from './whatsapp-cloud-provider';
import type { WhatsAppSettings } from './whatsapp-settings';

describe('WhatsAppCloudProvider con adjunto', () => {
  const fetchMock = vi.fn();
  let storage: MemoryAttachmentStorage;
  let provider: WhatsAppCloudProvider;
  const request = (overrides: Partial<SendMessageRequest> = {}): SendMessageRequest => ({
    tenantId: 't1',
    channel: { id: 'c1' } as SendMessageRequest['channel'],
    conversationId: 'k1',
    messageId: '0199c0de-0000-7000-8000-0000000000aa',
    to: '+573001110001',
    text: 'Te paso la cotización',
    attachment: { kind: 'DOCUMENT', mimeType: 'application/pdf', fileName: 'cotización.pdf', storageKey: 'k/pdf' },
    ...overrides,
  });

  beforeEach(async () => {
    storage = new MemoryAttachmentStorage();
    await storage.put('k/pdf', Buffer.from('%PDF'), { contentType: 'application/pdf', contentLength: 4 });
    const settings = {
      find: async () => ({ externalId: '1322469280958506', whatsappAccessTokenEnc: Buffer.from('e') }),
    } as unknown as WhatsAppSettings;
    const cipher = { encrypt: () => Buffer.alloc(0), decrypt: () => 'token-meta' };
    provider = new WhatsAppCloudProvider(settings, cipher, parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d' }), storage);
    fetchMock
      .mockResolvedValueOnce(Response.json({ id: 'media-up-1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.OUT' }] }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sube a /media y envía el documento con media id, pie y nombre', async () => {
    await expect(provider.send(request())).resolves.toEqual({ providerMessageId: 'wamid.OUT' });

    const [uploadUrl, upload] = fetchMock.mock.calls[0]!;
    expect(String(uploadUrl)).toMatch(/\/1322469280958506\/media$/);
    expect(upload.body).toBeInstanceOf(FormData);
    expect((upload.body as FormData).get('type')).toBe('application/pdf');
    const [, send] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(send.body)).toMatchObject({
      type: 'document',
      document: { id: 'media-up-1', caption: 'Te paso la cotización', filename: 'cotización.pdf' },
      biz_opaque_callback_data: '0199c0de-0000-7000-8000-0000000000aa',
    });
  });

  it('un audio no lleva caption', async () => {
    await storage.put('k/mp3', Buffer.from('ID3'), { contentType: 'audio/mpeg', contentLength: 3 });
    await provider.send(request({ text: '', attachment: { kind: 'AUDIO', mimeType: 'audio/mpeg', fileName: 'a.mp3', storageKey: 'k/mp3' } }));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ type: 'audio', audio: { id: 'media-up-1' } });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).audio).not.toHaveProperty('caption');
  });

  it('un fallo de /media lanza para que el Outbox reintente', async () => {
    fetchMock.mockReset().mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(provider.send(request())).rejects.toThrow(/media HTTP 500/);
  });
});
```

Añade a `n8n-messaging-provider.spec.ts`:

```ts
  it('rechaza adjuntos como canal no configurado', async () => {
    await expect(
      provider.send({
        ...request(),
        attachment: { kind: 'IMAGE', mimeType: 'image/png', fileName: null, storageKey: 'k' },
      }),
    ).rejects.toBeInstanceOf(ChannelNotConfiguredError);
  });
```

y `attachment: null` en el `request()` de ese spec y en el de `simulated-messaging-provider.spec.ts`.

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run src/modules/whatsapp src/modules/messaging`
Esperado: FAIL.

- [ ] **Paso 2: puerto y dispatcher**

En `messaging-provider.port.ts`:

```ts
import type { AttachmentKind } from '@omnidesk/contracts';

/** Archivo de un envío, ya guardado en el bucket. */
export interface OutboundAttachment {
  kind: AttachmentKind;
  mimeType: string;
  fileName: string | null;
  storageKey: string;
}
```

y en `SendMessageRequest`, después de `text`:

```ts
  /** Con adjunto, `text` es su pie (puede ser vacío). */
  attachment: OutboundAttachment | null;
```

En `dispatch-outbound-message.use-case.ts`, en la llamada a `send`:

```ts
        to: outbound.to,
        text: message.text,
        attachment: message.attachment?.storageKey
          ? {
              kind: message.attachment.kind,
              mimeType: message.attachment.mimeType,
              fileName: message.attachment.fileName,
              storageKey: message.attachment.storageKey,
            }
          : null,
```

En `n8n-messaging-provider.ts`, al inicio de `send`:

```ts
    if (request.attachment) throw new ChannelNotConfiguredError('el canal n8n no admite adjuntos');
```

- [ ] **Paso 3: proveedor WhatsApp Cloud**

Sustituye `whatsapp-cloud-provider.ts`:

```ts
import { buffer } from 'node:stream/consumers';
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../shared/config/env';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from '../attachments/application/ports/attachment-storage';
import {
  CHANNEL_SECRET_CIPHER,
  type ChannelSecretCipher,
} from '../channels/application/ports/channel-secret-cipher';
import {
  ChannelNotConfiguredError,
  type MessagingProvider,
  type OutboundAttachment,
  type SendMessageRequest,
} from '../messaging/application/ports/messaging-provider.port';
import { WhatsAppSettings } from './whatsapp-settings';

const SendResponse = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) });
const UploadResponse = z.object({ id: z.string().min(1) });

@Injectable()
export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(
    private readonly settings: WhatsAppSettings,
    @Inject(CHANNEL_SECRET_CIPHER) private readonly cipher: ChannelSecretCipher,
    @Inject(ENV) private readonly env: Env,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStorage,
  ) {}

  async send(request: SendMessageRequest): Promise<{ providerMessageId: string }> {
    const channel = await this.settings.find(request.channel.id, request.tenantId);
    if (!channel?.whatsappAccessTokenEnc)
      throw new ChannelNotConfiguredError('falta access token de WhatsApp');
    const authorization = `Bearer ${this.cipher.decrypt(channel.whatsappAccessTokenEnc)}`;
    const content = request.attachment
      ? await this.mediaContent(channel.externalId, authorization, request.attachment, request.text)
      : { type: 'text', text: { body: request.text } };
    const res = await fetch(`${this.graph(channel.externalId)}/messages`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: request.to.replace(/^\+/, ''),
        ...content,
        biz_opaque_callback_data: request.messageId,
      }),
    });
    if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}`);
    return { providerMessageId: SendResponse.parse(await res.json()).messages[0]!.id };
  }

  private graph(phoneNumberId: string): string {
    return `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}`;
  }

  /** Sube el archivo a Meta en cada intento: un reintento tras un fallo vuelve a subirlo. */
  private async mediaContent(
    phoneNumberId: string,
    authorization: string,
    attachment: OutboundAttachment,
    caption: string,
  ): Promise<Record<string, unknown>> {
    const bytes = await buffer((await this.storage.get(attachment.storageKey)).body);
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', attachment.mimeType);
    form.set(
      'file',
      new Blob([new Uint8Array(bytes)], { type: attachment.mimeType }),
      attachment.fileName ?? 'archivo',
    );
    const res = await fetch(`${this.graph(phoneNumberId)}/media`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { authorization },
      body: form,
    });
    if (!res.ok) throw new Error(`WhatsApp media HTTP ${res.status}`);
    const { id } = UploadResponse.parse(await res.json());
    const type = attachment.kind.toLowerCase();
    return {
      type,
      [type]: {
        id,
        ...(caption !== '' && attachment.kind !== 'AUDIO' && { caption }),
        ...(attachment.kind === 'DOCUMENT' &&
          attachment.fileName !== null && { filename: attachment.fileName }),
      },
    };
  }
}
```

- [ ] **Paso 4: e2e del envío**

Añade a `attachments.e2e-spec.ts` (importa `DispatchOutboundMessageUseCase`):

```ts
  it('el dispatcher sube el PDF a Graph y lo envía con media id; queda SENT', async () => {
    const conversationId = await openAssigned();
    const sent = await upload(conversationId, pdf, { caption: 'Cotización' }).expect(201);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: 'media-up-1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'wamid.OUT' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await app.get(DispatchOutboundMessageUseCase).send(tenantId, { messageId: sent.body.id });

    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: 'document',
      document: { id: 'media-up-1', caption: 'Cotización', filename: 'cotización.pdf' },
    });
    const message = await db.message.findUniqueOrThrow({ where: { id: sent.body.id } });
    expect(message).toMatchObject({ status: 'SENT', externalId: 'wamid.OUT' });
  });
```

Ejecuta: `pnpm --filter @omnidesk/api exec vitest run && pnpm --filter @omnidesk/api test:e2e`
Esperado: PASS en toda la suite.

- [ ] **Paso 5: commit**

```bash
git add apps/api/src/modules/messaging apps/api/src/modules/whatsapp apps/api/test/attachments.e2e-spec.ts
git commit -m "feat(whatsapp): upload and send agent attachments through Graph media"
```

---

### Tarea 9: Web — ver adjuntos y enviarlos desde el composer

**Archivos:**
- Modificar: `apps/web/src/shared/api/http-client.ts`
- Modificar: `apps/web/src/features/conversations/api/conversations-api.ts`
- Modificar: `apps/web/src/features/conversations/api/use-send-message.ts`
- Crear: `apps/web/src/features/conversations/model/attachment-view.ts` (+ `.spec.ts`)
- Crear: `apps/web/src/features/conversations/model/outbound-file.ts` (+ `.spec.ts`)
- Crear: `apps/web/src/features/conversations/ui/message-attachment.tsx`
- Modificar: `apps/web/src/features/conversations/ui/message-bubble.tsx:74-87`
- Modificar: `apps/web/src/features/conversations/ui/message-composer.tsx`
- Modificar: `apps/web/src/features/conversations/ui/chat-view.tsx:290` (sin cambios si la firma de `messaging.send` ya encaja)
- Modificar: los fixtures de `Message` en los `.spec.ts` de `features/conversations/model` (añade `attachment: null` si el typecheck lo pide)

**Interfaces:**
- Consume: `Attachment`, `attachmentContentPath`, `checkOutboundAttachment`, `OUTBOUND_ATTACHMENT_ACCEPT`, `MAX_ATTACHMENT_CAPTION_LENGTH` y `OutboundAttachmentRejection` (tarea 1); el endpoint de la tarea 7.
- Produce:
  - `postForm(path, form, options)` y `postAgentAttachment(conversationId, { file, caption, clientMessageId })`.
  - `toAttachmentView(attachment, base)` y `formatBytes(bytes)`.
  - `outboundFileProblem(file, caption): string | null` y `draftKey(draft): string`.
  - El tipo `Draft { text: string; file: File | null }`.

- [ ] **Paso 1: pruebas de modelo que fallan**

`model/attachment-view.spec.ts`:

```ts
import type { Attachment } from '@omnidesk/contracts';
import { describe, expect, it } from 'vitest';
import { formatBytes, toAttachmentView } from './attachment-view';

const attachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: '0199c0de-0000-7000-8000-000000000001',
  kind: 'IMAGE',
  mimeType: 'image/jpeg',
  fileName: null,
  sizeBytes: 1536,
  voice: false,
  status: 'READY',
  ...overrides,
});

describe('toAttachmentView', () => {
  it('arma la URL bajo la base del API y nombra el tipo', () => {
    expect(toAttachmentView(attachment(), '/omnidesk')).toEqual({
      variant: 'image',
      state: 'ready',
      src: '/omnidesk/api/v1/attachments/0199c0de-0000-7000-8000-000000000001/content',
      label: 'Foto',
      fileName: null,
      sizeLabel: '2 KB',
    });
  });

  it('distingue nota de voz, pendiente y fallido', () => {
    expect(toAttachmentView(attachment({ kind: 'AUDIO', voice: true }), '').label).toBe('Nota de voz');
    expect(toAttachmentView(attachment({ status: 'PENDING', sizeBytes: null }), '')).toMatchObject({
      state: 'pending',
      sizeLabel: null,
    });
    expect(toAttachmentView(attachment({ status: 'FAILED' }), '').state).toBe('failed');
  });
});

describe('formatBytes', () => {
  it('usa B, KB y MB con coma decimal', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(20_480)).toBe('20 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});
```

`model/outbound-file.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { draftKey, outboundFileProblem } from './outbound-file';

describe('outboundFileProblem', () => {
  it('null si se puede enviar', () => {
    expect(outboundFileProblem({ type: 'application/pdf', size: 1000 }, 'hola')).toBeNull();
  });

  it('explica cada rechazo en español', () => {
    expect(outboundFileProblem({ type: 'application/zip', size: 10 }, '')).toMatch(/no admitido/);
    expect(outboundFileProblem({ type: 'image/png', size: 6 * 1024 * 1024 }, '')).toMatch(/5 MB/);
    expect(outboundFileProblem({ type: 'audio/mpeg', size: 10 }, 'hola')).toMatch(/sin texto/);
  });
});

describe('draftKey', () => {
  const file = (name: string) => new File(['x'], name, { lastModified: 1 });

  it('cambia si cambia el texto o el archivo', () => {
    const a = draftKey({ text: 'hola', file: file('a.pdf') });
    expect(draftKey({ text: 'hola', file: file('a.pdf') })).toBe(a);
    expect(draftKey({ text: 'hola', file: file('b.pdf') })).not.toBe(a);
    expect(draftKey({ text: 'chao', file: file('a.pdf') })).not.toBe(a);
    expect(draftKey({ text: 'hola', file: null })).not.toBe(a);
  });
});
```

Ejecuta: `pnpm --filter @omnidesk/web exec vitest run src/features/conversations/model`
Esperado: FAIL.

- [ ] **Paso 2: modelo**

`model/attachment-view.ts`:

```ts
import { attachmentContentPath, type Attachment } from '@omnidesk/contracts';

export interface AttachmentView {
  variant: 'image' | 'sticker' | 'video' | 'audio' | 'document';
  state: 'pending' | 'ready' | 'failed';
  src: string;
  label: string;
  fileName: string | null;
  sizeLabel: string | null;
}

const LABELS: Record<Attachment['kind'], string> = {
  IMAGE: 'Foto',
  STICKER: 'Sticker',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  DOCUMENT: 'Documento',
};

/** `base` = `apiBase` (vacío o la subruta): la URL es del mismo origen y lleva la cookie. */
export function toAttachmentView(attachment: Attachment, base: string): AttachmentView {
  return {
    variant: attachment.kind.toLowerCase() as AttachmentView['variant'],
    state: attachment.status.toLowerCase() as AttachmentView['state'],
    src: `${base}${attachmentContentPath(attachment.id)}`,
    label: attachment.voice ? 'Nota de voz' : LABELS[attachment.kind],
    fileName: attachment.fileName,
    sizeLabel: attachment.sizeBytes === null ? null : formatBytes(attachment.sizeBytes),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}
```

`model/outbound-file.ts`:

```ts
import { checkOutboundAttachment, type OutboundAttachmentRejection } from '@omnidesk/contracts';

export interface Draft {
  text: string;
  file: File | null;
}

const MESSAGES: Record<OutboundAttachmentRejection, string> = {
  UNSUPPORTED_TYPE: 'Tipo de archivo no admitido. Usa JPG, PNG, PDF, Office, texto, audio o MP4',
  EMPTY: 'El archivo está vacío',
  TOO_LARGE: 'El archivo es demasiado grande: imágenes hasta 5 MB, el resto hasta 16 MB',
  CAPTION_NOT_ALLOWED: 'Los audios se envían sin texto',
  CAPTION_TOO_LONG: 'El texto de un adjunto admite hasta 1024 caracteres',
};

/** `null` si se puede enviar; si no, el aviso para el agente. Misma regla que el API. */
export function outboundFileProblem(file: { type: string; size: number }, caption: string): string | null {
  const check = checkOutboundAttachment({ mimeType: file.type, sizeBytes: file.size }, caption);
  return check.ok ? null : MESSAGES[check.reason];
}

/** Identifica el borrador: si cambia, el envío lleva un `clientMessageId` nuevo. */
export function draftKey({ text, file }: Draft): string {
  return `${text}\u0000${file ? `${file.name}:${file.size}:${file.lastModified}` : ''}`;
}
```

- [ ] **Paso 3: cliente HTTP y API**

En `http-client.ts`, haz que `requestJson` acepte `FormData` sin serializarlo y sin `content-type` (el navegador pone el boundary):

```ts
async function requestJson(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, allowUnauthorized = false }: RequestOptions,
): Promise<ApiResponse> {
  const isForm = body instanceof FormData;
  // …
      headers: {
        accept: 'application/json',
        'x-request-id': newRequestId(),
        ...(body !== undefined && !isForm && { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
```

y añade:

```ts
/** POST multipart (adjuntos). Timeout amplio: 16 MB con una conexión móvil lenta. */
export function postForm(
  path: string,
  form: FormData,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  return requestJson('POST', path, form, { timeoutMs: 60_000, ...options });
}
```

Conserva cualquier manejo de `429` que SPEC 10 haya añadido a `requestJson`.

En `conversations-api.ts` (importa `postForm`):

```ts
/** Sube un archivo con su pie; idempotente por `clientMessageId`, como `postAgentMessage`. */
export async function postAgentAttachment(
  conversationId: string,
  payload: { file: File; caption: string; clientMessageId: string },
): Promise<Message> {
  const form = new FormData();
  form.set('clientMessageId', payload.clientMessageId);
  form.set('caption', payload.caption);
  form.set('file', payload.file, payload.file.name);
  const { status, body } = await postForm(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/attachments`,
    form,
  );
  if (status === 200 || status === 201) return SendAgentMessageResponseSchema.parse(body);
  throw new SendMessageError(status);
}
```

En `use-send-message.ts`:

```ts
import { draftKey, type Draft } from '../model/outbound-file';
import { postAgentAttachment, postAgentMessage, postRetryMessage, SendMessageError } from './conversations-api';

export function sendNoticeFor(error: unknown): string {
  if (error instanceof SendMessageError) {
    if (error.status === 403) return 'Solo el agente asignado puede responder';
    if (error.status === 404) return 'La conversación ya no está disponible para ti';
    if (error.status === 409) return 'La conversación está cerrada o cambió';
    if (error.status === 413) return 'El archivo es demasiado grande: imágenes hasta 5 MB, el resto hasta 16 MB';
    if (error.status === 415) return 'Tipo de archivo no admitido';
  }
  // …igual que hoy…
}
```

Dentro del hook:

```ts
  const clientMessageId = useRef(newRequestId());
  // Un borrador distinto (otro texto u otro archivo) no puede reutilizar el id de un intento fallido.
  const lastDraft = useRef<string | null>(null);

  const send = useMutation({
    mutationFn: (draft: Draft) => {
      const key = draftKey(draft);
      if (lastDraft.current !== null && lastDraft.current !== key)
        clientMessageId.current = newRequestId();
      lastDraft.current = key;
      return draft.file
        ? postAgentAttachment(conversationId, {
            file: draft.file,
            caption: draft.text,
            clientMessageId: clientMessageId.current,
          })
        : postAgentMessage(conversationId, { text: draft.text, clientMessageId: clientMessageId.current });
    },
    onSuccess: () => {
      clientMessageId.current = newRequestId();
      lastDraft.current = null;
      setNotice(null);
      return refresh();
    },
    // onError igual que hoy
  });
  // …
  return {
    send: (draft: Draft, options?: { onSent: () => void }) =>
      send.mutate(draft, { onSuccess: options?.onSent }),
    // …resto igual…
  };
```

- [ ] **Paso 4: componentes**

`ui/message-attachment.tsx`:

```tsx
import type { Attachment } from '@omnidesk/contracts';
import { Download, FileText, ImageOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { apiBase } from '@/shared/config/env';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { toAttachmentView } from '../model/attachment-view';

/**
 * Las imágenes se abren en un visor dentro de la app: en la PWA de iOS una pestaña de Safari no
 * tiene la cookie de sesión.
 */
export function MessageAttachment({ attachment }: { attachment: Attachment }) {
  const view = toAttachmentView(attachment, apiBase);
  const [open, setOpen] = useState(false);
  const name = view.label.toLowerCase();

  if (view.state === 'pending')
    return (
      <p className="flex items-center gap-2 text-sm opacity-80">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Descargando {name}…
      </p>
    );
  if (view.state === 'failed')
    return (
      <p className="flex items-center gap-2 text-sm opacity-80">
        <ImageOff className="size-4" aria-hidden />
        No se pudo descargar {name}
      </p>
    );

  switch (view.variant) {
    case 'image':
      return (
        <>
          <button
            type="button"
            className="-mx-1 overflow-hidden rounded-xl"
            aria-label={`Ver ${name}`}
            onClick={() => setOpen(true)}
          >
            <img src={view.src} alt={view.label} loading="lazy" className="max-h-72 w-full max-w-xs object-cover" />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-[95vw] p-2">
              <DialogTitle className="sr-only">{view.label}</DialogTitle>
              <img src={view.src} alt={view.label} className="max-h-[80vh] w-full object-contain" />
              <a href={view.src} download className="text-sm underline underline-offset-2">
                Descargar
              </a>
            </DialogContent>
          </Dialog>
        </>
      );
    case 'sticker':
      return <img src={view.src} alt="Sticker" loading="lazy" className="size-32 object-contain" />;
    case 'video':
      return (
        <video src={view.src} controls playsInline preload="metadata" className="max-h-72 w-full max-w-xs rounded-xl" />
      );
    case 'audio':
      return (
        <span className="flex flex-col gap-1">
          <audio src={view.src} controls preload="metadata" className="w-64 max-w-full" />
          <a href={view.src} download className="text-xs underline underline-offset-2">
            Descargar {name}
          </a>
        </span>
      );
    case 'document':
      return (
        <a
          href={view.src}
          download={view.fileName ?? true}
          className="flex items-center gap-3 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/10"
        >
          <FileText className="size-8 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{view.fileName ?? 'Documento'}</span>
            {view.sizeLabel && <span className="text-xs opacity-75">{view.sizeLabel}</span>}
          </span>
          <Download className="size-4 shrink-0" aria-label="Descargar" />
        </a>
      );
  }
}
```

En `message-bubble.tsx`, sustituye el `<p>` del texto por:

```tsx
        {message.attachment && <MessageAttachment attachment={message.attachment} />}
        {message.text && (
          <p className="text-sm break-words whitespace-pre-wrap">{message.text}</p>
        )}
```

En `message-composer.tsx`:

```tsx
import {
  MAX_ATTACHMENT_CAPTION_LENGTH,
  OUTBOUND_ATTACHMENT_ACCEPT,
} from '@omnidesk/contracts';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { formatBytes } from '../model/attachment-view';
import { outboundFileProblem, type Draft } from '../model/outbound-file';

export const MAX_MESSAGE_LENGTH = 4096;
/** El contador aparece al acercarse al límite. */
export const COUNTER_MARGIN = 296;
const MAX_HEIGHT_PX = 160;

/**
 * Composer del agente asignado. Enter envía; Shift+Enter inserta un salto de línea. Un archivo
 * por mensaje; el texto es su pie. Texto y archivo se conservan si el envío falla.
 */
export function MessageComposer({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend: (draft: Draft, options: { onSent: () => void }) => void;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxLength = file ? MAX_ATTACHMENT_CAPTION_LENGTH : MAX_MESSAGE_LENGTH;
  const problem = file ? outboundFileProblem(file, text) : null;
  const canSend = (text.trim().length > 0 || file !== null) && problem === null && !sending;

  // …useLayoutEffect igual que hoy…

  const submit = () => {
    if (!canSend) return;
    onSend(
      { text: text.trim(), file },
      {
        onSent: () => {
          setText('');
          setFile(null);
        },
      },
    );
  };
  // …onKeyDown igual que hoy…

  return (
    <form /* …mismas clases y onSubmit… */>
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm">
          <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar adjunto" onClick={() => setFile(null)}>
            <X aria-hidden />
          </Button>
        </div>
      )}
      {problem && (
        <p className="text-destructive mb-2 text-xs" role="alert">
          {problem}
        </p>
      )}
      <div className="border-input bg-muted/40 focus-within:border-ring focus-within:ring-ring/50 flex items-end gap-1 rounded-3xl border py-1 pr-1 pl-1 transition-[color,box-shadow] focus-within:ring-[3px] dark:bg-input/30">
        <input
          ref={fileInputRef}
          type="file"
          accept={OUTBOUND_ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="rounded-full"
          aria-label="Adjuntar archivo"
          disabled={sending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip aria-hidden />
        </Button>
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          maxLength={maxLength}
          aria-label={file ? 'Texto del adjunto' : 'Escribe un mensaje'}
          placeholder={file ? 'Añade un texto (opcional)…' : 'Escribe un mensaje…'}
          className="placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-base outline-none md:text-sm"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {/* …botón Enviar igual que hoy… */}
      </div>
      {text.length >= maxLength - COUNTER_MARGIN && (
        <p className="text-muted-foreground mt-1 text-right text-xs" aria-live="polite">
          {text.length}/{maxLength}
        </p>
      )}
    </form>
  );
}
```

Si algún archivo importaba `COUNTER_FROM`, cámbialo por `COUNTER_MARGIN` (búscalo con `rg -n COUNTER_FROM apps/web`). `chat-view.tsx` pasa `messaging.send` tal cual y la nueva firma encaja. Si el typecheck se queja, no cambies nada más que el tipo.

- [ ] **Paso 5: ejecutar y ver que pasa**

```bash
pnpm --filter @omnidesk/contracts build
pnpm --filter @omnidesk/web exec vitest run
pnpm --filter @omnidesk/web typecheck && pnpm --filter @omnidesk/web lint
```

Esperado: PASS.

Prueba manual (local, con `docker compose up`): en `http://localhost:8080/omnidesk`, toma una conversación, adjunta un PDF con texto y comprueba que aparece la tarjeta con ✓. Adjunta un `.zip`: el aviso aparece y Enviar queda deshabilitado. Adjunta un `.mp3` con texto: aparece "Los audios se envían sin texto".

- [ ] **Paso 6: commit**

```bash
git add apps/web/src
git commit -m "feat(web): show attachments in chat and send files from the composer"
```

---

### Tarea 10: Infraestructura de producción y documentación

**Archivos:**
- Modificar: `infra/deploy/docker-compose.prod.yml`
- Modificar: `infra/deploy/.env.dev.example`, `infra/deploy/.env.prod.example`
- Modificar: `infra/deploy/backup.sh`
- Modificar: `infra/deploy/nginx-omnidesk.conf.example`
- Modificar: `docs/despliegue.md`, `docs/arquitectura.md`, `docs/integracion-n8n.md:121`, `README.md`
- Modificar: `specs/09-integracion-n8n-whatsapp.md` (Fuera de alcance) y `specs/12-retencion-rls.md` (nota de objetos)

- [ ] **Paso 1: compose de producción**

En `docker-compose.prod.yml`, añade el servicio:

```yaml
  # Adjuntos (SPEC 14). Sin consola; S3 solo en 127.0.0.1 (administración por túnel SSH).
  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    restart: unless-stopped
    command: server /data
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?falta MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?falta MINIO_ROOT_PASSWORD}
    ports:
      - '127.0.0.1:${MINIO_HOST_PORT:?falta MINIO_HOST_PORT}:9000'
    volumes:
      - miniodata:/data
    healthcheck:
      test: ['CMD', 'mc', 'ready', 'local']
      interval: 10s
      timeout: 5s
      retries: 10
```

En `api.environment`:

```yaml
      ATTACHMENT_STORAGE_DRIVER: s3
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_BUCKET: ${S3_BUCKET:-omnidesk-attachments}
      S3_ACCESS_KEY_ID: ${MINIO_ROOT_USER}
      S3_SECRET_ACCESS_KEY: ${MINIO_ROOT_PASSWORD}
      ATTACHMENT_INBOUND_MAX_BYTES: ${ATTACHMENT_INBOUND_MAX_BYTES:-26214400}
```

En `api.depends_on`, añade `minio: { condition: service_healthy }`. En `backup.volumes`, añade `- miniodata:/media:ro`. En `volumes:`, añade `miniodata:`.

En `.env.dev.example` (en `.env.prod.example`, con `MINIO_HOST_PORT=9060`):

```bash
# --- Adjuntos (SPEC 14): MinIO del proyecto ---
MINIO_ROOT_USER=omnidesk
# Solo letras y números. Genera con: openssl rand -hex 24
MINIO_ROOT_PASSWORD=<openssl rand -hex 24>
# Solo en 127.0.0.1. dev 9050, prod 9060 (no pueden coincidir en el mismo VPS).
MINIO_HOST_PORT=9050
```

- [ ] **Paso 2: backup del volumen**

En `infra/deploy/backup.sh`, añade debajo de `backup_once`:

```sh
# Adjuntos (SPEC 14): tar.gz del volumen de MinIO montado en /media. Sin montaje, no hace nada.
media_once() {
  [ -d /media ] || return 0
  file="${DIR}/${PREFIX}media-$(date +%Y%m%d).tar.gz"
  tar -czf "${file}.partial" -C /media .
  mv "${file}.partial" "$file"
  log "OK $(basename "$file") ($(du -h "$file" | cut -f1))"
  ls -1 "$DIR" | grep -E "^${PREFIX}media-[0-9]{8}\.tar\.gz$" | sort -r | tail -n +"$((KEEP + 1))" |
    while read -r old; do
      rm -f "${DIR}/${old}"
      log "Rotado ${old}"
    done
}
```

Sustituye `backup_once` por `backup_once && media_once` en la rama `now`, y `backup_once || log "ERROR: el backup falló"` por `{ backup_once && media_once; } || log "ERROR: el backup falló"` en el bucle.

Comprueba en local: `sh -n infra/deploy/backup.sh` (sin salida = sintaxis correcta).

- [ ] **Paso 3: Nginx**

En `nginx-omnidesk.conf.example`, dentro de `location /omnidesk/`, después de `proxy_read_timeout`:

```nginx
    # Adjuntos (SPEC 14): el API admite 16 MB por archivo; margen para el multipart.
    client_max_body_size 20m;
```

- [ ] **Paso 4: documentación**

- `docs/despliegue.md`, sección nueva "Adjuntos y MinIO (SPEC 14)". Debe explicar:
  - Qué variables hay que rellenar.
  - Que `client_max_body_size` es obligatorio (sin él, Nginx responde `413` a partir de 1 MB).
  - Cómo cargar la imagen si `docker pull` falla: `docker save minio/minio:RELEASE.2025-09-07T16-13-09Z | ssh vps docker load`.
  - Cómo restaurar: `$C stop api minio`, después `docker run --rm -v omnidesk-dev_miniodata:/data -v /srv/omnidesk/backups/dev:/b alpine sh -c 'rm -rf /data/* && tar -xzf /b/omnidesk-dev-media-YYYYMMDD.tar.gz -C /data'` y `$C up -d`.
  - Que el `tar` en caliente puede no incluir un objeto que se está escribiendo en ese momento.
  - Una fila nueva en "Problemas frecuentes": "`413` al adjuntar → falta `client_max_body_size`".
- `docs/arquitectura.md`, sección "Adjuntos". Incluye el diagrama del flujo:
  - Entrante: webhook → `MessageAttachment PENDING` → `attachment.download_requested` → Graph → MinIO → `READY` → `conversation.changed`.
  - Saliente: multipart → MinIO → `message.send_requested` → Graph `/media` → `/messages`.
  - Explica también el endpoint de contenido y la decisión de no pasar adjuntos a la IA.
- `docs/integracion-n8n.md:121`: sustituye "Solo texto libre. No se gestionan plantillas, multimedia…" por "Solo texto libre hacia la IA: los mensajes con adjunto (SPEC 14) o de tipos no soportados no se envían a n8n y quedan para atención humana. No se gestionan plantillas ni la ventana de atención de Meta."
- `README.md`: añade a la tabla de variables `ATTACHMENT_STORAGE_DRIVER`, las `S3_*`, `MINIO_*` y `ATTACHMENT_INBOUND_MAX_BYTES`, y la consola de MinIO en `http://localhost:9051`.
- `specs/09-…`, "Fuera de alcance": cambia "multimedia" por "multimedia (cubierto por SPEC 14)".
- `specs/12-retencion-rls.md`, en el job de retención, añade: "Antes de borrar mensajes, borra del bucket los `message_attachments.storage_key` no nulos (SPEC 14). La fila cae en cascada; el objeto no." Si RLS se aplica, incluye `message_attachments` en la lista de tablas con `tenant_id`.

- [ ] **Paso 5: commit**

```bash
git add infra docs README.md specs
git commit -m "docs(infra): run MinIO in production, back it up and document attachments"
```

---

### Tarea 11: Verificación completa y prueba real

- [ ] **Paso 1: suite completa**

```bash
pnpm --filter @omnidesk/contracts build
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @omnidesk/api test:e2e
S3_E2E_ENDPOINT=http://localhost:9050 pnpm --filter @omnidesk/api exec vitest run --config vitest.e2e.config.ts test/s3-storage.e2e-spec.ts
```

Esperado: todo en verde. Si SPEC 10 ya trae `pnpm e2e` (Playwright), ejecútalo también: el escenario de texto no debe romperse.

- [ ] **Paso 2: prueba real con WhatsApp (entorno con túnel)**

1. `docker compose up -d --build`. Comprueba que `docker compose ps` muestra `minio` en `healthy` y que el bucket `omnidesk-attachments` aparece en `http://localhost:9051`.
2. Desde un teléfono real, envía al número del canal una foto, una foto con pie, un PDF con nombre con tilde, una nota de voz, un video corto, un sticker, una ubicación y una reacción.
3. En la bandeja: cada uno aparece una vez. La foto pasa de "Descargando foto…" a la miniatura en pocos segundos y el visor abre la imagen. El PDF descarga con su nombre. La nota de voz suena en Chrome y Safari, o al menos se descarga. El video se reproduce en el iPhone (PWA instalada). La ubicación sale como "[Mensaje de WhatsApp no soportado: location]". La reacción no aparece.
4. Toma la conversación y envía al cliente: un JPG con texto, un PDF, un MP3 sin texto y un MP4. Comprueba en el teléfono que llegan con su pie y nombre, y que en OmniDesk pasan a ✓✓.
5. Con la IA activa en el canal, envía una foto: no debe aparecer `ai.reply_requested` en `outbox_events`.
6. Revisa `docker compose logs api | rg -i "sin estados|descarga"`: no debe quedar ningún webhook de media descartado.
7. Anota el resultado en la sección "Verificación de implementación" de `specs/14-adjuntos-whatsapp.md` y marca los criterios cumplidos.

- [ ] **Paso 3: commit final**

```bash
git add specs/14-adjuntos-whatsapp.md
git commit -m "docs(spec-14): record attachment verification"
```
