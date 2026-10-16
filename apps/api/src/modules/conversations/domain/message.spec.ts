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
        attachment: { kind: 'IMAGE' },
      }),
    ).toBe('Foto · Mi factura');
  });

  it('usa el nombre del documento y distingue la nota de voz', () => {
    expect(
      previewSource({
        text: '',
        attachment: { kind: 'DOCUMENT', fileName: 'cotización.pdf' },
      }),
    ).toBe('Documento: cotización.pdf');
    expect(
      previewSource({
        text: '',
        attachment: { kind: 'AUDIO', voice: true },
      }),
    ).toBe('Nota de voz');
  });

  it('con la fila de la base: documento sin nombre y adjunto nulo', () => {
    expect(previewSource({ text: '', attachment: { kind: 'DOCUMENT', fileName: null } })).toBe(
      'Documento',
    );
    expect(previewSource({ text: 'Hola', attachment: null })).toBe('Hola');
  });
});
