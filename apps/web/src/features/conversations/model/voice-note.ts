import { Mp3Encoder } from '@breezystack/lamejs';

const MPEG_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);
const BLOCK = 1152;

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array();
  if (channels.length === 1) return first;
  const mono = new Float32Array(first.length);
  for (let index = 0; index < first.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mono[index] = sum / channels.length;
  }
  return mono;
}

/** Lame solo admite tasas MPEG. El resto se acerca a 44,1 kHz. */
export function toMpegRate(samples: Float32Array, sampleRate: number): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (MPEG_RATES.has(sampleRate)) return { samples, sampleRate };
  const target = 44100;
  const length = Math.max(1, Math.round((samples.length * target) / sampleRate));
  const resampled = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = (index * sampleRate) / target;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    resampled[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return { samples: resampled, sampleRate: target };
}

export function encodeMp3(samples: Float32Array, sampleRate: number): Blob {
  const prepared = toMpegRate(samples, sampleRate);
  const encoder = new Mp3Encoder(1, prepared.sampleRate, 64);
  const pcm = floatToPcm16(prepared.samples);
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += BLOCK) {
    const chunk = encoder.encodeBuffer(pcm.subarray(offset, offset + BLOCK));
    if (chunk.length > 0) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);
  const merged = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.byteLength;
  }
  return new Blob([merged], { type: 'audio/mpeg' });
}

interface DecodedAudio {
  sampleRate: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** Graba lo que entregue el navegador y lo deja en MP3, que WhatsApp acepta. */
export async function voiceNoteFile(
  blob: Blob,
  decode: (blob: Blob) => Promise<DecodedAudio> = decodeWithAudioContext,
): Promise<File> {
  const audio = await decode(blob);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  const mp3 = encodeMp3(mixToMono(channels), audio.sampleRate);
  if (mp3.size === 0) throw new Error('audio vacío');
  return new File([mp3], `nota-${Date.now()}.mp3`, { type: 'audio/mpeg', lastModified: Date.now() });
}

async function decodeWithAudioContext(blob: Blob): Promise<DecodedAudio> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    return buffer;
  } finally {
    await context.close();
  }
}
