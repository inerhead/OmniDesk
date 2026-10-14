import { describe, expect, it } from 'vitest';
import { draftKey, outboundFileProblem } from './outbound-file';

describe('outboundFileProblem', () => {
  it('null si se puede enviar', () => {
    expect(outboundFileProblem({ type: 'application/pdf', size: 1000 }, 'hola')).toBeNull();
  });

  it('explica cada rechazo en español', () => {
    expect(outboundFileProblem({ type: 'application/zip', size: 10 }, '')).toMatch(/no admitido/);
    expect(outboundFileProblem({ type: 'image/png', size: 6 * 1024 * 1024 }, '')).toMatch(/5 MB/);
    expect(outboundFileProblem({ type: 'audio/mpeg', size: 10 }, 'hola')).toMatch(/sin texto/);
  });
});

describe('draftKey', () => {
  const file = (name: string) => new File(['x'], name, { lastModified: 1 });

  it('cambia si cambia el texto o el archivo', () => {
    const a = draftKey({ text: 'hola', file: file('a.pdf') });
    expect(draftKey({ text: 'hola', file: file('a.pdf') })).toBe(a);
    expect(draftKey({ text: 'hola', file: file('b.pdf') })).not.toBe(a);
    expect(draftKey({ text: 'chao', file: file('a.pdf') })).not.toBe(a);
    expect(draftKey({ text: 'hola', file: null })).not.toBe(a);
  });
});
