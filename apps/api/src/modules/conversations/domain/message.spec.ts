import { describe, expect, it } from 'vitest';
import { previewSource } from './message';

describe('previewSource', () => {
  it('sin adjunto devuelve el texto', () => {
    expect(previewSource({ text: 'Hola' })).toBe('Hola');
  });

  it('nombra el tipo y añade el pie', () => {
    expect(
      previewSource({
        text: 'Mi factura',
        attachment: { kind: 'IMAGE', mimeType: 'image/jpeg', status: 'PENDING' },
      }),
    ).toBe('Foto · Mi factura');
  });

  it('usa el nombre del documento y distingue la nota de voz', () => {
    expect(
      previewSource({
        text: '',
        attachment: {
          kind: 'DOCUMENT',
          mimeType: 'application/pdf',
          status: 'PENDING',
          fileName: 'cotización.pdf',
        },
      }),
    ).toBe('Documento: cotización.pdf');
    expect(
      previewSource({
        text: '',
        attachment: { kind: 'AUDIO', mimeType: 'audio/ogg', status: 'PENDING', voice: true },
      }),
    ).toBe('Nota de voz');
  });
});
