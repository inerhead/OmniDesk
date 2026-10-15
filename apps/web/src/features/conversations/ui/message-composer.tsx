import {
  MAX_ATTACHMENT_CAPTION_LENGTH,
  OUTBOUND_ATTACHMENT_TYPES,
  type AttachmentKind,
} from '@omnidesk/contracts';
import {
  AudioLines,
  Camera,
  FileText,
  Images,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  SendHorizontal,
  Smile,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/shared/ui/button';
import { formatBytes } from '../model/attachment-view';
import { outboundFileProblem, type Draft } from '../model/outbound-file';
import { VoiceCapture } from '../model/voice-capture';
import { formatElapsed, voiceNoteFile } from '../model/voice-note';

function acceptFor(kind: AttachmentKind): string {
  const mimes = Object.entries(OUTBOUND_ATTACHMENT_TYPES)
    .filter(([, rule]) => rule.kind === kind)
    .map(([mime]) => mime);
  if (kind === 'AUDIO') mimes.push('.m4a');
  return mimes.join(',');
}

const ATTACHMENT_ACTIONS: {
  label: string;
  accept: string;
  capture?: 'environment';
  icon: LucideIcon;
  circleClass: string;
}[] = [
  {
    label: 'Fotos y videos',
    accept: `${acceptFor('IMAGE')},${acceptFor('VIDEO')}`,
    icon: Images,
    circleClass: 'bg-sky-500',
  },
  {
    label: 'Cámara',
    accept: acceptFor('IMAGE'),
    capture: 'environment',
    icon: Camera,
    circleClass: 'bg-slate-600',
  },
  {
    label: 'Documento',
    accept: acceptFor('DOCUMENT'),
    icon: FileText,
    circleClass: 'bg-blue-600',
  },
  { label: 'Audio', accept: acceptFor('AUDIO'), icon: AudioLines, circleClass: 'bg-orange-500' },
];

const EMOJIS = [
  '😀', '😁', '😂', '😊', '😍', '😘', '😎', '🤔', '😢', '😡',
  '👍', '👎', '🙏', '👏', '🔥', '✅', '❤️', '🎉', '👋', '✨',
];

export const MAX_MESSAGE_LENGTH = 4096;
/** El contador aparece al acercarse al límite. */
export const COUNTER_MARGIN = 296;
const MAX_HEIGHT_PX = 160;

type RecordingPhase = 'idle' | 'recording' | 'paused' | 'encoding';

const WAVE_SLOTS = 42;

function VoiceWave({ levels, frozen }: { levels: number[]; frozen: boolean }) {
  const shown = levels.slice(-WAVE_SLOTS);
  return (
    <div className="flex h-6 min-w-0 flex-1 items-center" aria-hidden>
      {Array.from({ length: WAVE_SLOTS }, (_, index) => {
        const level = shown[index];
        const recorded = level !== undefined;
        return (
          <span key={index} className="flex h-6 min-w-0 flex-1 items-center justify-center">
            <span
              className={`w-1 rounded-full ${
                recorded
                  ? frozen
                    ? 'bg-muted-foreground/50'
                    : 'bg-muted-foreground/80'
                  : 'bg-muted-foreground/35'
              }`}
              style={{ height: `${recorded ? Math.max(4, Math.round(4 + level * 18)) : 4}px` }}
            />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Composer del agente asignado. Enter envía; Shift+Enter inserta un salto de línea. Un archivo
 * por mensaje; el texto es su pie. El micrófono graba una nota y la envía como audio.
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
  const [trayOpen, setTrayOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const finishingRef = useRef(false);
  const maxLength = file ? MAX_ATTACHMENT_CAPTION_LENGTH : MAX_MESSAGE_LENGTH;
  const problem = file ? outboundFileProblem(file, text) : null;
  const hasDraft = text.trim().length > 0 || file !== null;
  const canSend = hasDraft && problem === null && !sending && phase === 'idle';

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text]);

  useEffect(() => {
    return () => captureRef.current?.cancel();
  }, []);

  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    // iOS enfoca en touchstart y desplaza toda la página. preventDefault ahí solo
    // vale en un listener no pasivo; luego el foco se abre sin ese scroll.
    const onTouchStart = (event: TouchEvent) => {
      if (document.activeElement === field) return;
      event.preventDefault();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (document.activeElement === field) return;
      event.preventDefault();
      field.focus({ preventScroll: true });
    };
    field.addEventListener('touchstart', onTouchStart, { passive: false });
    field.addEventListener('touchend', onTouchEnd);
    return () => {
      field.removeEventListener('touchstart', onTouchStart);
      field.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // Con el teclado abierto iOS gasta el primer toque en cerrarlo y, al encogerse
    // la caja, el botón ya no está bajo el dedo. El toque se guarda al bajar y se
    // ejecuta al soltar. preventDefault en touchstart cancela el gesto del selector
    // de archivos y del micrófono, así que solo se cancela el click fantasma.
    let pressed: { button: HTMLButtonElement; x: number; y: number } | null = null;
    let touchAt = 0;

    const buttonFrom = (event: TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      const button = target.closest('button');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return null;
      return button;
    };

    const onTouchStart = (event: TouchEvent) => {
      const button = buttonFrom(event);
      const touch = event.changedTouches[0];
      pressed = button && touch ? { button, x: touch.clientX, y: touch.clientY } : null;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const start = pressed;
      pressed = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx * dx + dy * dy > 144) return;
      if (start.button.disabled || !start.button.isConnected) return;
      event.preventDefault();
      touchAt = event.timeStamp;
      start.button.click();
    };

    const onTouchCancel = () => {
      pressed = null;
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!event.isTrusted || touchAt === 0) return;
      if (Math.abs(event.timeStamp - touchAt) > 700) return;
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
    };

    form.addEventListener('touchstart', onTouchStart);
    form.addEventListener('touchend', onTouchEnd);
    form.addEventListener('touchcancel', onTouchCancel);
    form.addEventListener('click', onClickCapture, true);
    return () => {
      form.removeEventListener('touchstart', onTouchStart);
      form.removeEventListener('touchend', onTouchEnd);
      form.removeEventListener('touchcancel', onTouchCancel);
      form.removeEventListener('click', onClickCapture, true);
    };
  }, []);

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

  const pick = (accept: string, capture?: 'environment') => {
    const input = fileInputRef.current;
    if (!input || sending) return;
    input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    else input.removeAttribute('capture');
    input.click();
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    if (next.length > maxLength) return;
    setText(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      const caret = start + emoji.length;
      element?.setSelectionRange(caret, caret);
    });
  };

  const startRecording = async () => {
    if (sending || phase !== 'idle' || hasDraft) return;
    setNotice(null);
    setTrayOpen(false);
    setEmojiOpen(false);
    const capture = new VoiceCapture();
    captureRef.current = capture;
    try {
      setLevels([]);
      setElapsed(0);
      await capture.start({
        onTick: (ms) => setElapsed(ms),
        onLimit: () => void finishRecording(true),
        onLevel: (level) => setLevels((current) => [...current, level].slice(-WAVE_SLOTS)),
      });
      setPhase('recording');
    } catch {
      capture.cancel();
      captureRef.current = null;
      setNotice('El navegador bloqueó el micrófono.');
    }
  };

  const finishRecording = async (send: boolean) => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const capture = captureRef.current;
    captureRef.current = null;
    try {
      if (!capture) {
        setPhase('idle');
        return;
      }
      if (!send) {
        capture.cancel();
        setLevels([]);
        setPhase('idle');
        return;
      }
      const { blob, tooShort } = await capture.stop();
      if (tooShort) {
        setPhase('idle');
        setNotice('La nota es demasiado corta.');
        return;
      }
      setPhase('encoding');
      try {
        const note = await voiceNoteFile(blob);
        const issue = outboundFileProblem(note, '');
        if (issue) {
          setNotice(issue);
          return;
        }
        onSend({ text: '', file: note }, { onSent: () => setNotice(null) });
      } catch {
        setNotice('No se pudo preparar el audio.');
      } finally {
        setPhase('idle');
      }
    } finally {
      finishingRef.current = false;
    }
  };

  const togglePause = () => {
    const capture = captureRef.current;
    if (!capture) return;
    if (phase === 'recording') {
      capture.pause();
      setPhase('paused');
      return;
    }
    if (phase === 'paused') {
      capture.resume();
      setPhase('recording');
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const roundAction =
    'size-9 shrink-0 rounded-full bg-[#25D366] text-white hover:bg-[#1ebe5a] disabled:opacity-50';
  const circleButton = 'text-muted-foreground size-9 shrink-0 rounded-full';
  const voicing = phase === 'recording' || phase === 'paused' || phase === 'encoding';

  return (
    <form
      ref={formRef}
      className="shrink-0 px-2 py-1.5 md:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {file && phase === 'idle' && (
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
      {notice && (
        <p className="text-destructive mb-2 text-xs" role="alert">
          {notice}
        </p>
      )}
      {trayOpen && phase === 'idle' && (
        <div id="attachment-tray" className="bg-muted mb-2 rounded-2xl p-2 md:w-fit">
          <ul className="grid grid-cols-2 gap-1 md:flex md:flex-wrap">
            {ATTACHMENT_ACTIONS.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  className="hover:bg-background/70 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm md:w-auto disabled:opacity-50"
                  disabled={sending}
                  onClick={() => pick(action.accept, action.capture)}
                >
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-white ${action.circleClass}`}
                  >
                    <action.icon className="size-4" aria-hidden />
                  </span>
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {voicing ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={circleButton}
              aria-label="Descartar audio"
              disabled={phase === 'encoding'}
              onClick={() => void finishRecording(false)}
            >
              <Trash2 aria-hidden />
            </Button>
            <div
              className="border-input bg-background flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-full border px-3"
              role="status"
            >
              <span
                className={`size-2.5 shrink-0 rounded-full bg-red-500 ${phase === 'recording' ? 'animate-pulse' : ''}`}
                aria-hidden
              />
              <span className="w-9 shrink-0 text-sm tabular-nums">{formatElapsed(elapsed)}</span>
              {phase === 'encoding' ? (
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  Preparando audio…
                </span>
              ) : (
                <VoiceWave levels={levels} frozen={phase === 'paused'} />
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={circleButton}
              aria-label={phase === 'paused' ? 'Reanudar grabación' : 'Pausar grabación'}
              disabled={phase === 'encoding'}
              onClick={togglePause}
            >
              {phase === 'paused' ? <Play aria-hidden /> : <Pause aria-hidden />}
            </Button>
            <Button
              type="button"
              size="icon"
              className={roundAction}
              aria-label="Enviar audio"
              disabled={phase === 'encoding'}
              onClick={() => void finishRecording(true)}
            >
              <SendHorizontal aria-hidden />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={circleButton}
            aria-label="Adjuntar archivo"
            aria-expanded={trayOpen}
            aria-controls="attachment-tray"
            disabled={sending}
            onClick={() => {
              setEmojiOpen(false);
              setTrayOpen((open) => !open);
            }}
          >
            <Plus className="size-6" aria-hidden />
          </Button>
        )}

        {!voicing && (
          <div className="border-input bg-background relative flex min-h-9 flex-1 items-end rounded-full border pr-0.5 pl-3">
            <textarea
              ref={textareaRef}
              value={text}
              rows={1}
              maxLength={maxLength}
              aria-label={file ? 'Texto del adjunto' : 'Escribe un mensaje'}
              placeholder={file ? 'Añade un texto (opcional)…' : 'Escribe un mensaje'}
              className="placeholder:text-muted-foreground max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base leading-6 outline-none md:text-sm"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setEmojiOpen(false)}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="text-muted-foreground mb-0.5 size-8 rounded-full"
              aria-label="Emojis"
              aria-expanded={emojiOpen}
              disabled={sending}
              onClick={() => {
                setTrayOpen(false);
                setEmojiOpen((open) => !open);
              }}
            >
              <Smile aria-hidden />
            </Button>
            {emojiOpen && (
              <div className="bg-popover absolute right-0 bottom-full z-10 mb-2 grid grid-cols-5 gap-1 rounded-2xl border p-2 shadow-md">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="hover:bg-accent size-9 rounded-lg text-lg"
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!voicing &&
          (hasDraft ? (
            <Button
              type="submit"
              size="icon"
              className={roundAction}
              disabled={!canSend}
              aria-label="Enviar"
            >
              <SendHorizontal aria-hidden />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className={roundAction}
              disabled={sending}
              aria-label="Grabar audio"
              onClick={() => void startRecording()}
            >
              <Mic className="size-5" aria-hidden />
            </Button>
          ))}
      </div>
      {text.length >= maxLength - COUNTER_MARGIN && phase === 'idle' && (
        <p className="text-muted-foreground mt-1 text-right text-xs" aria-live="polite">
          {text.length}/{maxLength}
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          event.target.value = '';
          setTrayOpen(false);
        }}
      />
    </form>
  );
}
