// Browser-side protocol helpers for the static speech-to-speech demo.
// Endpoints checked against provider docs (October 2026):
// - xAI: POST /v1/realtime/client_secrets, then wss://api.x.ai/v1/realtime
// - OpenAI: POST /v1/live/sessions (WebRTC) and wss://api.openai.com/v1/live/sessions
// - Gemini: BidiGenerateContent WebSocket, PCM16 16 kHz in / 24 kHz out

export const INSTRUCTIONS_DEFAULT =
  'Ти голосовий асистент. Відповідай лише українською, коротко і природно, як у живій розмові.';

export const XAI_CLIENT_SECRETS_URL = 'https://api.x.ai/v1/realtime/client_secrets';
export const XAI_REALTIME_URL = 'wss://api.x.ai/v1/realtime';
export const OPENAI_LIVE_HTTP = 'https://api.openai.com/v1/live/sessions';
export const OPENAI_LIVE_WS = 'wss://api.openai.com/v1/live/sessions';

export const GEMINI_WS_BETA =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const GEMINI_WS_ALPHA =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';

export const SILENCE_RMS = 0.015;

export const MODELS = [
  {
    id: 'grok-voice-3',
    name: 'Grok Voice 3.0',
    provider: 'SpaceXAI',
    key: 'xai',
    rank: '1',
    index: 86.9,
    ttfa: null,
    price: '$4.80/год вх. аудіо (API, анонс; $0.08/хв)',
    kind: 'xai',
    model: 'grok-voice-3.0',
    fallbackModel: 'grok-voice-latest',
    note: 'Документація API досі називає grok-voice-latest і grok-voice-think-fast-2.0. Анонс Grok Voice 3.0 каже, що grok-voice-latest уже перемкнено на 3.0. Якщо grok-voice-3.0 відхилено, буде повтор із grok-voice-latest.',
  },
  {
    id: 'gpt-live-astra',
    name: 'GPT-Live-1 (Astra, medium)',
    provider: 'OpenAI',
    key: 'openai',
    rank: '2',
    index: 83.2,
    ttfa: 1.34,
    price: '$5.83/год вх. аудіо',
    kind: 'openai-live',
    model: 'gpt-live-1',
    backend: 'gpt-6-astra',
    effort: 'medium',
  },
  {
    id: 'gemini-38-et',
    name: 'Gemini 3.8 Live Extended Thinking (High)',
    provider: 'Google',
    key: 'gemini',
    rank: '3',
    index: 82.6,
    ttfa: 1.35,
    price: '$3.50/год вх. аудіо',
    kind: 'gemini',
    model: 'gemini-3.8-live-extended-thinking',
    thinking: 'HIGH',
  },
  {
    id: 'grok-think-fast-2',
    name: 'Grok Voice Think Fast 2.0 (High)',
    provider: 'SpaceXAI',
    key: 'xai',
    rank: '4',
    index: 81.3,
    ttfa: 0.7,
    price: '$4.80/год вх. аудіо',
    kind: 'xai',
    model: 'grok-voice-think-fast-2.0',
  },
  {
    id: 'gpt-live-sol',
    name: 'GPT-Live-1 (Sol, low)',
    provider: 'OpenAI',
    key: 'openai',
    rank: '5',
    index: 80.1,
    ttfa: 1.24,
    price: '$4.47/год вх. аудіо',
    kind: 'openai-live',
    model: 'gpt-live-1',
    backend: 'gpt-6-sol',
    effort: 'low',
  },
  {
    id: 'gemini-38',
    name: 'Gemini 3.8 Live (бонус)',
    provider: 'Google',
    key: 'gemini',
    rank: 'бонус',
    index: 76.0,
    ttfa: 1.18,
    price: '$0.84/год вх. аудіо',
    kind: 'gemini',
    model: 'gemini-3.8-live',
    thinking: '',
  },
];

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

export function explainConnectError(err, endpoint) {
  const host = hostOf(endpoint);
  const name = err && err.name;
  if (name === 'TypeError' || name === 'NetworkError' || (err && /failed to fetch|networkerror|load failed/i.test(String(err.message)))) {
    if (host === 'api.openai.com') {
      return 'Браузер не зміг прочитати відповідь api.openai.com: у відповіді немає Access-Control-Allow-Origin (CORS). Хибний ключ OpenAI часто повертається саме так, тож код HTTP схований. Перевірте ключ; далі буде запасне WebSocket-підключення.';
    }
    return `Браузер не зміг прочитати відповідь ${host}. Це типова ознака CORS або блокування мережі: статична сторінка не отримала доступний HTTP-статус. Запит ішов лише до провайдера, ключ нікуди більше не надсилався.`;
  }
  if (err && err.status) {
    const detail = err.detail || err.message || '';
    return `HTTP ${err.status} від ${host}: ${detail}`.trim();
  }
  return (err && err.message) || String(err);
}

export function httpError(status, detail, endpoint) {
  const err = new Error(`HTTP ${status} від ${hostOf(endpoint)}: ${detail || ''}`.trim());
  err.status = status;
  err.detail = detail || '';
  return err;
}

export async function readHttpError(response, endpoint) {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      const raw = json.error?.message || json.error || json.message || json.code || text;
      detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch {
      detail = text.slice(0, 500);
    }
  } catch {
    detail = response.statusText || '';
  }
  return httpError(response.status, detail, endpoint);
}

export function explainWsClose(code, reason, endpoint) {
  const host = hostOf(endpoint);
  const why = reason ? ` Причина: ${reason}.` : '';
  if (code === 1006) {
    return `WebSocket до ${host} закрито з кодом 1006 (з’єднання обірвалось без нормального закриття). Так буває, коли handshake заблоковано, ключ відхилено без тіла відповіді, або мережа недоступна.${why}`;
  }
  if (code === 1008 || code === 4001 || code === 4003) {
    return `WebSocket до ${host} відхилено (код ${code}). Перевірте ключ і id моделі.${why}`;
  }
  return `WebSocket до ${host} закрито (код ${code || 'невідомий'}).${why}`;
}

export function clamp16(n) {
  const r = Math.round(n);
  if (r < -32768) return -32768;
  if (r > 32767) return 32767;
  return r;
}

export function floatToPcm16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? clamp16(s * 0x8000) : clamp16(s * 0x7fff);
  }
  return out;
}

export function resampleLinear(int16, fromRate, toRate) {
  if (!int16 || fromRate === toRate) return int16;
  const n = Math.max(1, Math.round(int16.length * toRate / fromRate));
  const out = new Int16Array(n);
  const ratio = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const t = x - j;
    const a = int16[Math.min(j, int16.length - 1)] || 0;
    const b = int16[Math.min(j + 1, int16.length - 1)] || 0;
    out[i] = clamp16(a * (1 - t) + b * t);
  }
  return out;
}

export function pcm16Rms(int16) {
  if (!int16 || !int16.length) return 0;
  let sum = 0;
  for (let i = 0; i < int16.length; i++) {
    const x = int16[i] / 32768;
    sum += x * x;
  }
  return Math.sqrt(sum / int16.length);
}

export function isNonSilent(int16, threshold = SILENCE_RMS) {
  return pcm16Rms(int16) >= threshold;
}

export function pcm16ToBase64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToPcm16(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const even = bytes.byteLength - (bytes.byteLength % 2);
  return new Int16Array(bytes.buffer, 0, even >> 1);
}

export function concatFloat32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function xaiSessionUpdate(instructions) {
  return {
    type: 'session.update',
    session: {
      voice: 'eve',
      instructions,
      turn_detection: null,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { language_hint: 'uk' },
        },
        output: { format: { type: 'audio/pcm', rate: 24000 } },
      },
    },
  };
}

export function xaiAppend(b64) {
  return { type: 'input_audio_buffer.append', audio: b64 };
}

export function xaiEndMessages() {
  return [
    { type: 'input_audio_buffer.commit' },
    { type: 'response.create' },
  ];
}

export function xaiSocketUrl(modelId) {
  return `${XAI_REALTIME_URL}?model=${encodeURIComponent(modelId)}`;
}

export function xaiSubprotocol(token) {
  return `xai-client-secret.${token}`;
}

export function openaiLiveBody({ model, instructions, backend, effort, sdp }) {
  return {
    session: {
      model,
      instructions,
      delegation: {
        type: 'responses',
        responses: {
          model: backend,
          reasoning: { effort },
          instructions,
        },
      },
    },
    transport: { type: 'webrtc', sdp },
  };
}

export function openaiSessionStart({ model, instructions, backend, effort }) {
  return {
    type: 'session.start',
    session: {
      model,
      instructions,
      audio: {
        format: { type: 'audio/pcm', rate: 24000 },
        output: { voice: 'marin' },
      },
      delegation: {
        type: 'responses',
        responses: {
          model: backend,
          reasoning: { effort },
          instructions,
        },
      },
    },
  };
}

export function openaiAppend(b64) {
  return { type: 'session.input_audio.append', audio: b64 };
}

export function openaiSilencePcm(sampleRate = 24000, seconds = 0.6) {
  return new Int16Array(Math.round(sampleRate * seconds));
}

export function openaiWsProtocols(apiKey) {
  return ['realtime', `openai-insecure-api-key.${apiKey}`];
}

export function geminiModelName(modelId) {
  const bare = String(modelId || '').replace(/^models\//, '');
  return `models/${bare}`;
}

export function geminiSetup({ model, instructions, thinking }) {
  const generationConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } },
    },
  };
  if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
  return {
    setup: {
      model: geminiModelName(model),
      generationConfig,
      systemInstruction: { parts: [{ text: instructions }] },
      outputAudioTranscription: {},
    },
  };
}

export function geminiAudioMessage(b64) {
  return {
    realtimeInput: {
      audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
    },
  };
}

export function geminiEndMessage() {
  return { realtimeInput: { audioStreamEnd: true } };
}

export function geminiSocketUrl(base, apiKey) {
  const root = String(base || GEMINI_WS_BETA).replace(/[?].*$/, '');
  return `${root}?key=${encodeURIComponent(apiKey)}`;
}

function errorMessage(value) {
  if (!value) return 'невідома помилка';
  if (typeof value === 'string') return value.slice(0, 500);
  if (value.message) return String(value.message).slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value);
  }
}

export function classifyEvent(kind, event) {
  if (!event || typeof event !== 'object') return { type: 'ignore' };

  if (kind === 'xai') {
    if (event.type === 'response.output_audio.delta' || event.type === 'response.audio.delta') {
      return { type: 'audio', b64: event.delta || '' };
    }
    if (
      event.type === 'response.output_audio_transcript.delta' ||
      event.type === 'response.audio_transcript.delta'
    ) {
      return { type: 'transcript', role: 'assistant', text: event.delta || '' };
    }
    if (event.type === 'response.done' || event.type === 'response.output_audio.done') return { type: 'done' };
    if (event.type === 'session.updated' || event.type === 'session.created' || event.type === 'conversation.created') {
      return { type: 'ready' };
    }
    if (event.type === 'error') return { type: 'error', message: errorMessage(event.error || event) };
    return { type: 'ignore', rawType: event.type || '' };
  }

  if (kind === 'openai-live') {
    if (event.type === 'session.started' || event.type === 'session.created') return { type: 'ready' };
    if (event.type === 'session.output_audio.delta') return { type: 'audio', b64: event.delta || '' };
    if (event.type === 'session.output_transcript.delta') {
      return { type: 'transcript', role: 'assistant', text: event.delta || '' };
    }
    if (event.type === 'session.input_transcript.delta') {
      return { type: 'transcript', role: 'user', text: event.delta || '' };
    }
    if (event.type === 'error') return { type: 'error', message: errorMessage(event.error || event) };
    if (event.type === 'session.closed') return { type: 'done' };
    return { type: 'ignore', rawType: event.type || '' };
  }

  if (kind === 'gemini') {
    if (event.error) return { type: 'error', message: errorMessage(event.error) };
    if (event.setupComplete) return { type: 'ready' };
    const sc = event.serverContent;
    const audios = [];
    const parts = sc?.modelTurn?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) audios.push(part.inlineData.data);
    }
    const text = sc?.outputTranscription?.text || sc?.outputTranscription?.transcript || '';
    const interactionStatus = event.interactionStatus || event.interaction_status || sc?.interactionStatus || sc?.interaction_status || '';
    if (!sc && !interactionStatus) return { type: 'ignore' };
    return {
      type: 'content',
      audios,
      text,
      turnComplete: !!(sc && (sc.turnComplete || sc.turn_complete)),
      interactionStatus: interactionStatus ? String(interactionStatus).toUpperCase() : '',
    };
  }

  return { type: 'ignore' };
}

export function geminiTurnFinished(kind, classified, thinking) {
  if (kind !== 'gemini' || !classified) return false;
  if (classified.type === 'done') return true;
  if (classified.type !== 'content') return false;
  if (thinking) {
    if (classified.interactionStatus === 'IDLE') return true;
    if (classified.turnComplete && classified.interactionStatus && classified.interactionStatus !== 'IN_PROGRESS') return true;
    return false;
  }
  return classified.turnComplete;
}

export function looksLikeUnknownModel(message) {
  return /model|not found|unknown model|unsupported|does not exist|невідом/i.test(String(message || ''));
}
