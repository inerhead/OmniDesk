import { publicAsset } from '@/shared/config/env';

/**
 * El texto que lee Google está en `public/privacidad.html` y `public/terminos.html`:
 * la respuesta HTTP lleva el documento, sin esperar a JavaScript.
 */
function LegalFrame({ title, file }: { title: string; file: string }) {
  return (
    <iframe
      title={title}
      src={publicAsset(file)}
      className="bg-background h-full w-full border-0"
    />
  );
}

export function PrivacyPage() {
  return <LegalFrame title="Política de privacidad" file="privacidad.html" />;
}

export function TermsPage() {
  return <LegalFrame title="Términos del servicio" file="terminos.html" />;
}
