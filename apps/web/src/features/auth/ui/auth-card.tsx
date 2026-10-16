import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeMenu } from '@/shared/theme/theme-menu';
import { publicAsset } from '@/shared/config/env';

const BENEFITS = [
  'Todas las conversaciones de WhatsApp en un lugar',
  'La IA responde y tu equipo toma el control cuando hace falta',
  'En tiempo real, también desde el móvil',
];

/** Panel de marca de OmniDesk (≥ lg, SPEC 21): siempre de OmniDesk, también en la invitación. */
function BrandPanel() {
  return (
    <aside className="bg-primary text-primary-foreground hidden w-1/2 shrink-0 flex-col gap-12 p-12 lg:flex xl:w-[45%] xl:p-16">
      <div className="flex items-center gap-3">
        <img src={publicAsset('logo.svg')} alt="" className="size-10" />
        <span className="text-lg font-semibold tracking-tight">OmniDesk</span>
      </div>
      <div className="my-auto flex max-w-md flex-col gap-8">
        <h2 className="text-4xl leading-tight font-semibold tracking-tight text-balance">
          Supervisa la IA y a tu equipo en una sola bandeja.
        </h2>
        <ul className="flex flex-col gap-4">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-3">
              <span className="bg-primary-foreground/15 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full">
                <Check aria-hidden className="size-4" />
              </span>
              <span className="text-primary-foreground/90">{benefit}</span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/**
 * Pantallas sin sesión o sin empresa (login, onboarding, invitación). En ≥ lg, pantalla partida
 * (SPEC 21): panel de marca a la izquierda y el contenido a la derecha, sin tarjeta y con su propio
 * scroll. En < lg, la tarjeta centrada de siempre.
 */
export function AuthCard({
  title,
  description,
  mark,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Marca en lugar del logo de OmniDesk (la empresa, en la invitación). */
  mark?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-muted/40 lg:bg-background flex h-full min-h-0">
      <BrandPanel />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-10">
        <div className="absolute top-3 right-3">
          <ThemeMenu side="bottom" />
        </div>
        {/* `m-auto` centra sin cortar arriba cuando el contenido es más alto que la pantalla. */}
        <main className="bg-card text-card-foreground m-auto flex w-full max-w-sm flex-col gap-6 rounded-2xl border p-6 shadow-sm sm:p-8 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="flex flex-col items-center gap-3 text-center">
            {/* En ≥ lg el logo de OmniDesk ya está en el panel; la marca de la empresa se queda. */}
            {mark ?? (
              <img src={publicAsset('logo.svg')} alt="OmniDesk" className="size-10 lg:hidden" />
            )}
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-muted-foreground text-sm">{description}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
