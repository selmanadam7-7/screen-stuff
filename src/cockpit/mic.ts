/**
 * Listening to the microphone, for one number.
 *
 * Nothing is recorded, sent anywhere, or kept. The audio never leaves the Web
 * Audio graph: the only thing that comes out of this file is a loudness reading
 * between 0 and 1, several times a second, so the shot can tell whether you are
 * talking.
 *
 * It is opened only while the feature is on, and closed the moment it is turned
 * off — a microphone held open by an app nobody asked is the sort of thing that
 * deserves the suspicion it gets.
 */

import { levelOf } from "../core/voice";

export class MicLevel {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private timer: number | null = null;
  private stopped = false;

  /** Non-null when the microphone could not be opened. */
  error: string | null = null;

  /**
   * Start listening. `onLevel` is called about thirty times a second.
   *
   * Resolves once the microphone is open, or once it is clear it will not be.
   */
  async start(onLevel: (level: number) => void): Promise<void> {
    this.stopped = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // The point is to hear the room, not to transmit it. Leaving the
          // processing on keeps a keyboard from reading as a voice.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : "no microphone";
      return;
    }
    if (this.stopped) {
      this.stream.getTracks().forEach((t) => t.stop());
      return;
    }

    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    // Small window: this is a level meter, not a spectrogram, and a big FFT
    // would just add latency to something that has to feel immediate.
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));

    this.timer = window.setInterval(() => {
      if (!this.analyser || !this.buffer) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      onLevel(levelOf(this.buffer));
    }, 33);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.analyser = null;
    this.buffer = null;
  }
}
