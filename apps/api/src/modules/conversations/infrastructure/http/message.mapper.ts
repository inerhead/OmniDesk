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
