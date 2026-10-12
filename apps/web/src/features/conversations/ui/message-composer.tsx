import { SendHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/shared/ui/button';

export const MAX_MESSAGE_LENGTH = 4096;
/** El contador aparece al acercarse al límite. */
export const COUNTER_FROM = 3800;
const MAX_HEIGHT_PX = 160;

/**
 * Composer del agente asignado. Enter envía; Shift+Enter inserta un salto de línea. El texto se
 * conserva si el envío falla. Respeta `safe-area-inset-bottom` (home indicator de iOS).
 */
export function MessageComposer({
  sending,
  onSend,
}: {
  sending: boolean;
  onSend: (text: string, options: { onSent: () => void }) => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = text.trim().length > 0 && !sending;

  // Autoajusta el alto al contenido, con tope.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), { onSent: () => setText('') });
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
      className="bg-background shrink-0 border-t px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:px-6"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-label="Escribe un mensaje"
          placeholder="Escribe un mensaje…"
          className="border-input bg-background focus-visible:ring-ring/50 max-h-40 min-h-9 flex-1 resize-none rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px] md:text-sm"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="submit" size="sm" className="h-9" disabled={!canSend} aria-label="Enviar">
          <SendHorizontal aria-hidden />
        </Button>
      </div>
      {text.length >= COUNTER_FROM && (
        <p className="text-muted-foreground mt-1 text-right text-xs" aria-live="polite">
          {text.length}/{MAX_MESSAGE_LENGTH}
        </p>
      )}
    </form>
  );
}
