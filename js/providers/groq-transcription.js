/**
 * Groq transcription provider — REAL file-based speech-to-text, unlike
 * captions-provider.js (which only transcribes live mic audio in
 * Chrome/Edge via the Web Speech API). This works on any saved recording,
 * in any browser, because the actual transcription happens on Groq's
 * servers, not in the browser.
 *
 * Free tier: Groq's Whisper endpoint has a genuinely free tier (get a key
 * at console.groq.com/keys, no card required at time of writing). This is
 * the one truly "free-tier paid API" in this app's provider list.
 *
 * The API key lives only in this browser's localStorage and is sent
 * directly to api.groq.com — never through any server of ours (there is
 * no server).
 */
(function () {
  const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
  const MODEL = 'whisper-large-v3-turbo';

  function getApiKey() {
    const configured = (window.VS && window.VS.config && window.VS.config.groqApiKey || '').trim();
    if (configured) return configured;
    return (localStorage.getItem('vs_groq_api_key') || '').trim();
  }

  class GroqTranscriptionProvider {
    static get hasApiKey() { return !!getApiKey(); }

    /**
     * @param {Blob} blob - the recording's audio/video blob (Groq accepts webm directly)
     * @returns {Promise<Array<{start:number,end:number,text:string}>>}
     */
    static async transcribe(blob, onProgress) {
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error('Transcription isn\'t configured yet.');
      }

      if (onProgress) onProgress('Uploading to Groq...');
      const form = new FormData();
      form.append('file', blob, 'audio.webm');
      form.append('model', MODEL);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');

      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });

      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error?.message || ''; } catch (e) {}
        if (res.status === 401) throw new Error('Groq rejected the API key (401) — check it in Settings.');
        if (res.status === 429) throw new Error('Groq free-tier rate limit hit (429) — wait a moment and try again.');
        throw new Error(`Groq transcription failed (HTTP ${res.status}). ${detail}`);
      }

      if (onProgress) onProgress('Processing transcript...');
      const data = await res.json();
      const segments = data.segments || [];
      if (segments.length === 0 && data.text) {
        // model returned plain text with no segment timing — still usable, just one cue for the whole clip
        return [{ start: 0, end: data.duration || 0, text: data.text.trim() }];
      }
      return segments.map(s => ({ start: s.start, end: s.end, text: s.text.trim() })).filter(c => c.text);
    }
  }

  window.VS = window.VS || {};
  window.VS.GroqTranscriptionProvider = GroqTranscriptionProvider;
})();
