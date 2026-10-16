import type { SVGProps } from 'react';

export type ChatReplyIconMode = 'idle' | 'loop' | 'once';

/**
 * Icono de Conversaciones (SPEC 17): el bocadillo del cliente y la respuesta, animados con
 * `.chat-in` y `.chat-out` (index.css). La respuesta se rellena con `--nav-icon-bg`, el fondo del
 * botón que la contiene, para tapar limpio al primer bocadillo.
 * `mode` (SPEC 21): quieto en reposo, en bucle hasta entrar a Conversaciones o una sola pasada.
 */
export function ChatReplyIcon({
  className,
  mode = 'idle',
  ...props
}: Omit<SVGProps<SVGSVGElement>, 'mode'> & { mode?: ChatReplyIconMode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} data-mode={mode} {...props}>
      <path
        className="chat-in"
        d="M4 2.5h9a2 2 0 0 1 2 2V9a2 2 0 0 1-2 2H7.5L4.5 13.5V11H4a2 2 0 0 1-2-2V4.5a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        className="chat-out"
        d="M20 9.5h-9a2 2 0 0 0-2 2V16a2 2 0 0 0 2 2h5.5l3 2.5V18h.5a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2z"
        fill="var(--nav-icon-bg, var(--background))"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
