import { describe, expect, it } from 'vitest';
import { cleanFileName, contentDisposition, decodeMultipartFileName } from './file-name';

describe('contentDisposition', () => {
  it('imágenes, audio y video en línea; el resto como descarga', () => {
    expect(contentDisposition('image/jpeg', null)).toBe('inline');
    expect(contentDisposition('audio/ogg', null)).toBe('inline');
    expect(contentDisposition('image/svg+xml', null)).toBe('attachment');
    expect(contentDisposition('text/html', 'x.html')).toMatch(/^attachment;/);
  });

  it('codifica el nombre UTF-8 y neutraliza comillas y saltos de línea', () => {
    expect(contentDisposition('application/pdf', 'cotización "final"\r\n.pdf')).toBe(
      `attachment; filename="cotizaci_n _final___.pdf"; filename*=UTF-8''${encodeURIComponent('cotización "final"\r\n.pdf')}`,
    );
  });
});

describe('cleanFileName / decodeMultipartFileName', () => {
  it('quita rutas y recorta a 255', () => {
    expect(cleanFileName('C:\\fotos\\..\\a.png')).toBe('a.png');
    expect(cleanFileName('x'.repeat(300))).toHaveLength(255);
    expect(cleanFileName('   ')).toBe('archivo');
  });

  it('recupera UTF-8 que busboy entregó como latin1 y no toca lo ya correcto', () => {
    const mangled = Buffer.from('cotización.pdf', 'utf8').toString('latin1');
    expect(decodeMultipartFileName(mangled)).toBe('cotización.pdf');
    expect(decodeMultipartFileName('cotización.pdf')).toBe('cotización.pdf');
  });
});
