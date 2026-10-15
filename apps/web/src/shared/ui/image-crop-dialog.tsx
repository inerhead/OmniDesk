import { useState } from 'react';
import Cropper from 'react-easy-crop';
// La CSP de producción no admite el <style> que la librería inyecta: sus estilos van como CSS.
import 'react-easy-crop/react-easy-crop.css';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { cropToBlob, loadImage, type CropArea } from '@/shared/lib/crop-to-blob';

/**
 * Recorte cuadrado de una imagen: circular para la foto de perfil, rectangular para el logo. Se carga
 * en diferido (`import()`) desde la página que lo usa: react-easy-crop no entra en el bundle inicial.
 */
export default function ImageCropDialog({
  source,
  shape,
  title,
  saving,
  onCancel,
  onSave,
}: {
  /** URL `data:` de la imagen elegida; `null` = cerrado. */
  source: string | null;
  shape: 'round' | 'rect';
  title: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (image: Blob) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!source || !area) return;
    setError(null);
    try {
      onSave(await cropToBlob(await loadImage(source), area));
    } catch {
      setError('No se pudo preparar la imagen. Prueba con otra.');
    }
  }

  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent className="gap-3">
        <DialogTitle className="pr-6">{title}</DialogTitle>
        <DialogDescription>Arrastra para moverla y usa el zoom para acercarla.</DialogDescription>
        <div className="bg-muted relative aspect-square w-full overflow-hidden rounded-lg">
          {source && (
            <Cropper
              image={source}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape={shape}
              showGrid={false}
              disableAutomaticStylesInjection
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          )}
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground shrink-0">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="accent-primary w-full"
            aria-label="Zoom"
          />
        </label>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving || !area} onClick={() => void save()}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
