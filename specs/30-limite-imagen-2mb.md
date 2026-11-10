# SPEC 30 — Límite de 2 MB para la foto de perfil y el logo de empresa

> **Status:** Approved
> **Depends on:** SPEC 15, SPEC 16
> **Date:** 2026-11-10
> **Objective:** La web rechaza, con un aviso, las imágenes de más de 2 MB elegidas como foto de perfil o logo de empresa, y muestra ese límite antes de elegir el archivo.

## Por qué existe este spec

Hoy la foto de perfil (SPEC 15) y el logo de empresa (SPEC 16) comparten el mismo flujo:

- La web acepta un JPEG, PNG o WebP de hasta **10 MB** (`IMAGE_SOURCE_MAX_BYTES` en `packages/contracts/src/images.ts`, comprobado por `checkImageSource` en `apps/web/src/shared/lib/crop-to-blob.ts`).
- La web lo recorta a 512×512 y sube un WebP o JPEG.
- El API acepta como máximo **1 MB** (`IMAGE_UPLOAD_MAX_BYTES`).

El usuario quiere que el archivo elegido no pase de 2 MB. El límite del API ya es más estricto y no cambia.

## Alcance

**Dentro:**

- **Constante:** `IMAGE_SOURCE_MAX_BYTES` pasa de `10 * 1024 * 1024` a `2 * 1024 * 1024`. El alias `AVATAR_SOURCE_MAX_BYTES` (`packages/contracts/src/profile.ts`) la sigue sin cambios.
- **Validación en la web:** `checkImageSource` sigue igual. Al leer la constante, rechaza con `too-large` un archivo de más de 2 MB (2 097 152 bytes). Exactamente 2 MB se acepta.
- **Aviso al superar el límite**, en «Mi perfil» (`features/profile/profile-page.tsx`) y en «Empresa» (`features/company/company-page.tsx`):
  - Texto: «La imagen supera 2 MB. Elige una más pequeña.»
  - No se abre el recorte. Funciona igual que hoy con 10 MB.
- **Texto de ayuda** debajo de los botones «Subir foto»/«Cambiar foto» y «Subir logo»/«Cambiar logo»:
  - Texto: «JPEG, PNG o WebP. Máximo 2 MB.»
  - Estilo de texto secundario (`text-muted-foreground text-xs`).
  - Se ve siempre que se ven esos botones.
- **Un solo origen del «2 MB»:** el aviso y la ayuda construyen el texto a partir de `IMAGE_SOURCE_MAX_BYTES`, con una etiqueta exportada desde `shared/lib/crop-to-blob.ts` (`IMAGE_SOURCE_MAX_LABEL = '2 MB'`, calculada de la constante). Cambiar la constante cambia los dos textos.
- **Pruebas:** `crop-to-blob.spec.ts` pasa a probar el borde de 2 MB (acepta `2 MB`, rechaza `2 MB + 1`) y el valor de la etiqueta.

**Fuera de alcance (para futuros specs):**

- Cambiar `IMAGE_UPLOAD_MAX_BYTES` (1 MB) o cualquier validación del API.
- Adjuntos del chat (`MAX_OUTBOUND_ATTACHMENT_BYTES`, 16 MB) y adjuntos entrantes (`ATTACHMENT_INBOUND_MAX_BYTES`).
- Comprimir o reducir automáticamente una imagen que supere el límite.
- Cambiar los formatos aceptados, el tamaño del recorte (512×512) o la calidad de exportación.
- Editar los specs 15 y 16: son históricos y describen el límite de entonces.

## Modelo de datos

Este spec no introduce estructuras persistentes ni cambia la forma de ningún contrato. Solo cambia el valor de una constante y añade una etiqueta en la web.

```ts
// packages/contracts/src/images.ts
/** Lo que acepta la web antes de recortar. */
export const IMAGE_SOURCE_MAX_BYTES = 2 * 1024 * 1024; // antes: 10 * 1024 * 1024

// apps/web/src/shared/lib/crop-to-blob.ts
/** «2 MB»: límite del archivo elegido, para el aviso y la ayuda. */
export const IMAGE_SOURCE_MAX_LABEL: string; // `${IMAGE_SOURCE_MAX_BYTES / (1024 * 1024)} MB`
```

| Límite | Constante | Antes | Después |
| --- | --- | --- | --- |
| Archivo elegido en la web | `IMAGE_SOURCE_MAX_BYTES` | 10 MB | 2 MB |
| Recorte que recibe el API | `IMAGE_UPLOAD_MAX_BYTES` | 1 MB | 1 MB (sin cambios) |

## Plan de implementación

1. **Constante y etiqueta.** `IMAGE_SOURCE_MAX_BYTES = 2 * 1024 * 1024` en `images.ts`. `IMAGE_SOURCE_MAX_LABEL` en `crop-to-blob.ts` y su comentario de `checkImageSource` («hasta 2 MB»). Actualizar `crop-to-blob.spec.ts` al borde de 2 MB y a la etiqueta. Comprobar: `pnpm --filter @omnidesk/contracts build` y `pnpm --filter @omnidesk/web exec vitest run src/shared/lib/crop-to-blob.spec.ts` pasan.
2. **Aviso.** En `profile-page.tsx` y `company-page.tsx`, el mensaje `too-large` usa `IMAGE_SOURCE_MAX_LABEL`. Comprobar en `http://localhost:8080/omnidesk/settings/profile`: un JPEG de 3 MB muestra «La imagen supera 2 MB. Elige una más pequeña.» y no abre el recorte.
3. **Texto de ayuda.** «JPEG, PNG o WebP. Máximo 2 MB.» (con `IMAGE_SOURCE_MAX_LABEL`) debajo de los botones de subir en las dos páginas. Comprobar en «Mi perfil» y en «Empresa» (Owner/Admin) que se ve el texto.

## Criterios de aceptación

- [ ] En «Mi perfil», elegir un JPEG, PNG o WebP de 2 MB o menos abre el recorte.
- [ ] En «Mi perfil», elegir una imagen de más de 2 MB muestra «La imagen supera 2 MB. Elige una más pequeña.» y no abre el recorte.
- [ ] En «Empresa», elegir un logo de 2 MB o menos abre el recorte.
- [ ] En «Empresa», elegir un logo de más de 2 MB muestra el mismo aviso y no abre el recorte.
- [ ] Debajo de «Subir foto»/«Cambiar foto» y de «Subir logo»/«Cambiar logo» aparece «JPEG, PNG o WebP. Máximo 2 MB.»
- [ ] Un GIF o un PDF sigue mostrando el aviso de formato no admitido, como antes.
- [ ] Guardar un recorte sigue subiendo una imagen de 512×512 y el API responde `200`.
- [ ] `PUT /api/v1/me/avatar` y la subida del logo siguen respondiendo `413` con más de 1 MB.
- [ ] En el código de la web no queda ningún «10 MB» relacionado con imágenes de perfil o logo.
- [ ] `crop-to-blob.spec.ts` prueba que 2 MB se acepta y 2 MB + 1 byte se rechaza, y pasa.
- [ ] `pnpm lint`, `pnpm typecheck` y `pnpm test` pasan.

## Decisiones

- **Sí:** el límite de 2 MB se aplica al archivo elegido en la web. Decisión del usuario. Es el que hoy está en 10 MB y el que nota quien sube la foto.
- **No:** subir el límite del API a 2 MB. Hoy es 1 MB y el recorte pesa ~50–100 KB. Subirlo solo daría más margen a un cliente que se salte la web.
- **No:** validar el archivo original en el API. Nunca llega al API: solo llega el recorte.
- **Sí:** solo foto de perfil y logo de empresa. Decisión del usuario. Son las dos subidas que comparten `IMAGE_SOURCE_MAX_BYTES`.
- **No:** limitar las imágenes del chat a 2 MB. Las fotos de móvil suelen pesar más, y WhatsApp tiene sus propios límites. Si hace falta, va en otro spec.
- **Sí:** rechazar con aviso. Decisión del usuario. Es el comportamiento actual con 10 MB, solo cambia el número.
- **No:** reducir la imagen automáticamente. Quitaría el límite real y añadiría código de compresión.
- **Sí:** texto de ayuda con el límite antes de elegir. Decisión del usuario. Evita que el usuario descubra el límite solo al fallar.
- **Sí:** los textos se construyen desde la constante. Evita que el aviso y la ayuda digan un número distinto del que se valida, como pasaría con «10 MB» escrito a mano en dos páginas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Las fotos de móvil (12+ MP) suelen pesar más de 2 MB y se rechazan. | Es lo que pide el usuario. La ayuda muestra el límite antes de elegir y el aviso pide una imagen más pequeña. |
| `1024 * 1024` frente a `1000 * 1000`: un archivo de «2 MB» según el sistema operativo puede pasar de 2 097 152 bytes, o no. | Se usa `1024 * 1024`, como el resto de constantes del proyecto. La diferencia es de un ~5 % en el borde. |

## Lo que **no** entra en este spec

- Cambios en el límite del API (1 MB) o en sus validaciones.
- Límites de los adjuntos del chat, entrantes o salientes.
- Compresión automática, nuevos formatos o cambios en el recorte.
- Editar los specs 15 y 16.

Cada uno, si llega, va en su propio spec.
