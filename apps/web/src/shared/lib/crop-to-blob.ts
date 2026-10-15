import {
  IMAGE_SIZE_PX,
  IMAGE_SOURCE_MAX_BYTES,
  IMAGE_SOURCE_MIME_TYPES,
} from '@omnidesk/contracts';

/** Área recortada en píxeles de la imagen original (`onCropComplete` de react-easy-crop). */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageSourceCheck = 'ok' | 'unsupported' | 'too-large';

/** Antes de abrir el recorte: JPEG, PNG o WebP de hasta 10 MB. */
export function checkImageSource(file: { type: string; size: number }): ImageSourceCheck {
  if (!(IMAGE_SOURCE_MIME_TYPES as readonly string[]).includes(file.type)) return 'unsupported';
  if (file.size > IMAGE_SOURCE_MAX_BYTES) return 'too-large';
  return 'ok';
}

const QUALITY = 0.85;

type ToBlob = (type: string, quality: number) => Promise<Blob | null>;

/** WebP si el navegador lo exporta; si no (Safari devuelve PNG), JPEG. */
export async function encodeImage(toBlob: ToBlob): Promise<Blob> {
  const webp = await toBlob('image/webp', QUALITY);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob('image/jpeg', QUALITY);
  if (!jpeg) throw new Error('No se pudo exportar la imagen');
  return jpeg;
}

/** Dibuja el área recortada en un lienzo de 512×512 y lo exporta. */
export async function cropToBlob(image: HTMLImageElement, area: CropArea): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SIZE_PX;
  canvas.height = IMAGE_SIZE_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas no disponible');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    IMAGE_SIZE_PX,
    IMAGE_SIZE_PX,
  );
  return encodeImage(
    (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
  );
}

/** URL `data:` (la CSP de producción no admite `blob:` en `img-src`). */
export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo abrir la imagen'));
    image.src = src;
  });
}
