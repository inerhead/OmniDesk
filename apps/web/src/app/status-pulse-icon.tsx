import type { SVGProps } from 'react';

/**
 * Icono de Estado: el trazo recorre el electrocardiograma y el pico se enciende en rojo.
 * Mismo ritmo en `.ecg-sweep` y `.ecg-dot` (index.css).
 */
export function StatusPulseIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} {...props}>
      <path
        d="M2 12h4l3-9 6 18 3-9h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.35"
      />
      <path
        className="ecg-sweep"
        d="M2 12h4l3-9 6 18 3-9h4"
        pathLength={100}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g className="ecg-dot">
        <circle cx="9" cy="3" r="2.6" fill="#ef4444" opacity="0.35" />
        <circle cx="9" cy="3" r="1.15" fill="#ef4444" />
      </g>
    </svg>
  );
}
