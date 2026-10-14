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

  // Autoajusta el alto al contenido, con tope.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // `isComposing`: Enter confirma una composición de teclado (IME), no envía.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="bg-background shrink-0 border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm">
          <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Quitar adjunto"
            onClick={() => setFile(null)}
          >
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
        <Button
          type="submit"
          size="icon"
          className="rounded-full"
          disabled={!canSend}
          aria-label="Enviar"
        >
          <SendHorizontal aria-hidden />
        </Button>
      </div>
      {text.length >= maxLength - COUNTER_MARGIN && (
        <p className="text-muted-foreground mt-1 text-right text-xs" aria-live="polite">
          {text.length}/{maxLength}
        </p>
      )}
    </form>
  );
}
