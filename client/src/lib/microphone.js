/**
 * Starts microphone capture and emits 16 kHz PCM16 chunks (~100 ms each).
 * Returns an async `stop()` that releases the microphone and audio graph.
 */
export async function startMicrophone({ onChunk, onLevel }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported in this browser (HTTPS is required).');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule('/pcm-worklet.js');
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
    throw err;
  }

  const source = context.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(context, 'pcm-processor');
  worklet.port.onmessage = ({ data }) => {
    onChunk(data.pcm);
    onLevel?.(data.level);
  };
  // The worklet must be connected to the destination to keep processing; it outputs silence.
  source.connect(worklet).connect(context.destination);

  return async function stop() {
    worklet.port.onmessage = null;
    source.disconnect();
    worklet.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await context.close();
  };
}
