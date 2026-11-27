/*
 * AudioWorklet that converts microphone audio (any sample rate, float32) into
 * 16 kHz mono 16-bit PCM and posts it to the main thread in ~100 ms chunks.
 */
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // `sampleRate` is a global in the worklet scope
    this.position = 0; // fractional read position into the incoming stream
    this.prev = 0; // last sample of the previous block, for interpolation across blocks
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outIndex = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // Linear-interpolation resampler. Index -1 refers to the last sample of the previous block.
    const n = channel.length;
    while (this.position < n) {
      const i = Math.floor(this.position);
      const frac = this.position - i;
      const a = i === 0 ? this.prev : channel[i - 1];
      const b = channel[i];
      const sample = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.sumSquares += sample * sample;
      this.out[this.outIndex++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this.outIndex === CHUNK_SAMPLES) {
        const level = Math.sqrt(this.sumSquares / CHUNK_SAMPLES);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outIndex = 0;
        this.sumSquares = 0;
      }
      this.position += this.ratio;
    }
    this.position -= n;
    this.prev = channel[n - 1];
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
