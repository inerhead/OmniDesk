import { describe, expect, it } from 'vitest';
import { encodeMp3, floatToPcm16, formatElapsed, mixToMono, toMpegRate } from './voice-note';

describe('voice-note', () => {
  it('formatea el cronómetro', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(4_200)).toBe('0:04');
    expect(formatElapsed(65_000)).toBe('1:05');
  });

  it('pasa de float a PCM 16 y mezcla a mono', () => {
    expect(floatToPcm16(new Float32Array([0, 1, -1]))).toEqual(new Int16Array([0, 32767, -32768]));
    const mono = mixToMono([new Float32Array([0, 1]), new Float32Array([1, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 1]);
  });

  it('codifica un tono corto como MP3', () => {
    const samples = new Float32Array(2000);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / 8) * 0.2;
    const mp3 = encodeMp3(samples, 48000);
    expect(mp3.type).toBe('audio/mpeg');
    expect(mp3.size).toBeGreaterThan(0);
  });

  it('reajusta una tasa que Lame no admite', () => {
    const { sampleRate, samples } = toMpegRate(new Float32Array(1000), 10000);
    expect(sampleRate).toBe(44100);
    expect(samples.length).toBeGreaterThan(1000);
  });
});