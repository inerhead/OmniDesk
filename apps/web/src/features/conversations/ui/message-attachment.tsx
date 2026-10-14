import type { Attachment } from '@omnidesk/contracts';
import { Download, FileText, ImageOff, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { apiBase } from '@/shared/config/env';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui/dialog';
import { toAttachmentView } from '../model/attachment-view';

/**
 * Las imágenes se abren en un visor dentro de la app: en la PWA de iOS una pestaña de Safari no
 * tiene la cookie de sesión.
 */
export function MessageAttachment({ attachment }: { attachment: Attachment }) {
  const view = toAttachmentView(attachment, apiBase);
  const [open, setOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const name = view.label.toLowerCase();

  if (view.state === 'pending')
    return (
      <p className="flex items-center gap-2 text-sm opacity-80">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Descargando {name}…
      </p>
    );
  if (view.state === 'failed' || missing)
    return (
      <p className="flex items-center gap-2 text-sm opacity-80">
        <ImageOff className="size-4" aria-hidden />
        {missing ? `No se encuentra ${name}` : `No se pudo descargar ${name}`}
      </p>
    );

  switch (view.variant) {
    case 'image':
      return (
        <>
          <button
            type="button"
            className="-mx-1 overflow-hidden rounded-xl"
            aria-label={`Ver ${name}`}
            onClick={() => setOpen(true)}
          >
            <img
              src={view.src}
              alt={view.label}
              loading="lazy"
              className="max-h-72 w-full max-w-xs object-cover"
              onError={() => setMissing(true)}
            />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-[95vw] p-2">
              <DialogTitle className="sr-only">{view.label}</DialogTitle>
              <img src={view.src} alt={view.label} className="max-h-[80vh] w-full object-contain" />
              <a href={view.src} download className="text-sm underline underline-offset-2">
                Descargar
              </a>
            </DialogContent>
          </Dialog>
        </>
      );
    case 'sticker':
      return (
        <img
          src={view.src}
          alt="Sticker"
          loading="lazy"
          className="size-32 object-contain"
          onError={() => setMissing(true)}
        />
      );
    case 'video':
      return (
        <video
          src={view.src}
          controls
          playsInline
          preload="metadata"
          className="max-h-72 w-full max-w-xs rounded-xl"
        />
      );
    case 'audio':
      return (
        <span className="flex flex-col gap-1">
          <audio src={view.src} controls preload="metadata" className="w-64 max-w-full" />
          <a href={view.src} download className="text-xs underline underline-offset-2">
            Descargar {name}
          </a>
        </span>
      );
    case 'document':
      return (
        <a
          href={view.src}
          download={view.fileName ?? true}
          className="flex items-center gap-3 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/10"
        >
          <FileText className="size-8 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {view.fileName ?? 'Documento'}
            </span>
            {view.sizeLabel && <span className="text-xs opacity-75">{view.sizeLabel}</span>}
          </span>
          <Download className="size-4 shrink-0" aria-label="Descargar" />
        </a>
      );
  }
}
