// Text to speech using the browser's built-in Web Speech API (no third-party service).

const isDevanagari = (text) => /[ऀ-ॿ]/.test(text);

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(text, { onEnd } = {}) {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  // Pick a Hindi voice when the text contains Devanagari, otherwise Indian English.
  utterance.lang = isDevanagari(text) ? 'hi-IN' : 'en-IN';
  const voice = window.speechSynthesis.getVoices().find((v) => v.lang?.replace('_', '-') === utterance.lang);
  if (voice) utterance.voice = voice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (ttsSupported) window.speechSynthesis.cancel();
}
