import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';
import { Card } from './card';
import { PageHeader } from './page-header';
import { Skeleton } from './skeleton';

const SECTION_GRID =
  'grid grid-cols-1 gap-4 border-t pt-6 first:border-t-0 first:pt-0 md:grid-cols-3 md:gap-8 md:pt-8';

/** Página de ajustes (SPEC 21): cabecera y secciones, con el ancho y el relleno de Miembros. */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 md:px-8 md:py-10">
        <PageHeader title={title} description={description} />
        <div className="flex flex-col gap-6 md:gap-8">{children}</div>
      </div>
    </div>
  );
}

/** Hueco de una sección mientras carga: la misma rejilla con skeletons. */
export function SettingsSectionSkeleton() {
  return (
    <section aria-busy="true" className={SECTION_GRID}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-40 w-full md:col-span-2" />
    </section>
  );
}

/**
 * Sección de una página de ajustes (SPEC 21). En ≥ md, dos columnas (1/3 y 2/3): título y
 * descripción a la izquierda, tarjeta con el contenido a la derecha. En < md se apila. Las secciones
 * se separan con una línea. `tone="danger"`: título en rojo y borde de la tarjeta rojizo.
 */
export function SettingsSection({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description?: ReactNode;
  tone?: 'danger';
  children: ReactNode;
}) {
  return (
    <section className={SECTION_GRID}>
      <div className="flex flex-col gap-1">
        <h2 className={cn('text-base font-semibold', tone === 'danger' && 'text-destructive')}>
          {title}
        </h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <Card
        className={cn(
          'min-w-0 gap-4 px-6 md:col-span-2',
          tone === 'danger' && 'border-destructive/40',
        )}
      >
        {children}
      </Card>
    </section>
  );
}
