const MAX_VOICE_MS = 120_000;

export interface VoiceCaptureHandlers {
  onTick: (elapsedMs: number) => void;
  onLimit: () => void;
  /** Nivel 0–1, unas 10 veces por segundo, para la onda. */
  onLevel: (level: number) => void;
}

/** Micrófono del navegador, con pausa y nivel de voz. */
export class VoiceCapture {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private timer: number | null = null;
  private meterTimer: number | null = null;
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterData: Uint8Array<ArrayBuffer> | null = null;
  private handlers: VoiceCaptureHandlers | null = null;
  private accumulated = 0;
  private segmentStart = 0;
  private paused = false;

  async start(handlers: VoiceCaptureHandlers): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((mime) =>
      MediaRecorder.isTypeSupported(mime),
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.chunks = [];
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.stream = stream;
    this.recorder = recorder;
    this.handlers = handlers;
    this.accumulated = 0;
    this.paused = false;
    this.segmentStart = Date.now();
    this.attachMeter(stream);
    recorder.start();
    this.startTimer();
    this.startMeter();
  }

  pause(): void {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== 'recording') return;
    this.accumulated += Date.now() - this.segmentStart;
    this.paused = true;
    recorder.pause();
    this.clearTimer();
    this.stopMeter();
  }

  resume(): void {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== 'paused') return;
    this.paused = false;
    this.segmentStart = Date.now();
    recorder.resume();
    this.startTimer();
    this.startMeter();
  }

  /** Para la grabación. `tooShort` si duró menos de 400 ms. */
  async stop(): Promise<{ blob: Blob; tooShort: boolean }> {
    const elapsed = this.elapsedMs();
    const recorder = this.recorder;
    this.clearTimer();
    this.stopMeter();
    if (!recorder) {
      this.release();
      return { blob: new Blob(), tooShort: true };
    }
    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        'stop',
        () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })),
        { once: true },
      );
      if (recorder.state === 'inactive') {
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
        return;
      }
      recorder.stop();
    });
    this.release();
    return { blob, tooShort: elapsed < 400 || blob.size === 0 };
  }

  cancel(): void {
    const recorder = this.recorder;
    this.clearTimer();
    this.stopMeter();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    this.release();
  }

  private elapsedMs(): number {
    if (this.paused) return this.accumulated;
    return this.accumulated + (Date.now() - this.segmentStart);
  }

  private startTimer(): void {
    this.clearTimer();
    this.timer = window.setInterval(() => {
      const elapsed = this.elapsedMs();
      this.handlers?.onTick(elapsed);
      if (elapsed >= MAX_VOICE_MS) this.handlers?.onLimit();
    }, 200);
  }

  private attachMeter(stream: MediaStream): void {
    const audio = new AudioContext();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    this.audio = audio;
    this.analyser = analyser;
    this.meterData = new Uint8Array(analyser.fftSize);
    void audio.resume();
  }

  private startMeter(): void {
    this.stopMeter();
    const analyser = this.analyser;
    const data = this.meterData;
    if (!analyser || !data) return;
    this.meterTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const sample = (value - 128) / 128;
        sum += sample * sample;
      }
      this.handlers?.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
    }, 100);
  }

  private stopMeter(): void {
    if (this.meterTimer) window.clearInterval(this.meterTimer);
    this.meterTimer = null;
  }

  private clearTimer(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.audio?.close();
    this.stream = null;
    this.recorder = null;
    this.audio = null;
    this.analyser = null;
    this.meterData = null;
    this.handlers = null;
    this.chunks = [];
  }
}
