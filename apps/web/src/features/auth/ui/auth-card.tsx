import type { ReactNode } from 'react';
import { ThemeMenu } from '@/shared/theme/theme-menu';
import { publicAsset } from '@/shared/config/env';

/** Pantallas sin sesión o sin empresa (login, onboarding, invitación): tarjeta centrada con marca. */
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
    <div className="bg-muted/40 relative flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="absolute top-3 right-3">
        <ThemeMenu side="bottom" />
      </div>
      <main className="bg-card text-card-foreground flex w-full max-w-sm flex-col gap-6 rounded-2xl border p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          {mark ?? <img src={publicAsset('logo.svg')} alt="OmniDesk" className="size-10" />}
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
