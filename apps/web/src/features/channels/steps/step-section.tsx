import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import type { ChannelStep } from '../model/channel-status';

/** Un paso del panel: número (o check si está completo), título, estado y su contenido. */
export function StepSection({ step, children }: { step: ChannelStep; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${step.key}`} className="flex gap-3">
      <span
        aria-hidden
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          step.done ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {step.done ? <Check className="size-4" /> : step.number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`step-${step.key}`} className="font-medium">
            {step.number}. {step.title}
          </h3>
          <span
            className={cn(
              'text-xs font-medium',
              step.done ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {step.done ? 'Completo' : 'Pendiente'}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}

/** Aviso de la última acción del paso (guardado, error, resultado de la prueba). */
export function StepNotice({ notice }: { notice: string }) {
  if (!notice) return null;
  return (
    <p role="status" className="text-sm">
      {notice}
    </p>
  );
}
