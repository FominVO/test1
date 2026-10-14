import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELS,
  SILENCE_RMS,
  resampleLinear,
  floatToPcm16,
  pcm16Rms,
  isNonSilent,
  pcm16ToBase64,
  base64ToPcm16,
  explainConnectError,
  explainWsClose,
  xaiSessionUpdate,
  xaiEndMessages,
  xaiSubprotocol,
  openaiLiveBody,
  openaiSessionStart,
  openaiSilencePcm,
  openaiWsProtocols,
  geminiSetup,
  geminiAudioMessage,
  geminiEndMessage,
  geminiSocketUrl,
  GEMINI_WS_BETA,
  classifyEvent,
  geminiTurnFinished,
  looksLikeUnknownModel,
} from './protocol.js';

test('AA roster keeps the requested top five plus bonus', () => {
  assert.deepEqual(MODELS.map((m) => [m.rank, m.index, m.kind]), [
    ['1', 86.9, 'xai'],
    ['2', 83.2, 'openai-live'],
    ['3', 82.6, 'gemini'],
    ['4', 81.3, 'xai'],
    ['5', 80.1, 'openai-live'],
    ['бонус', 76.0, 'gemini'],
  ]);
  assert.equal(MODELS[1].backend, 'gpt-6-astra');
  assert.equal(MODELS[1].effort, 'medium');
  assert.equal(MODELS[4].backend, 'gpt-6-sol');
  assert.equal(MODELS[4].effort, 'low');
  assert.equal(MODELS[2].model, 'gemini-3.8-live-extended-thinking');
  assert.equal(MODELS[2].thinking, 'HIGH');
});

test('resample 24 kHz to 16 kHz matches the relay ratio', () => {
  const src = new Int16Array(240);
  for (let i = 0; i < src.length; i++) src[i] = i * 10;
  const out = resampleLinear(src, 24000, 16000);
  assert.equal(out.length, 160);
  assert.equal(out[0], 0);
  assert.ok(out[2] > out[1]);
});

test('float to pcm16 round trip and silence gate', () => {
  const silent = floatToPcm16(new Float32Array(100));
  assert.equal(pcm16Rms(silent), 0);
  assert.equal(isNonSilent(silent), false);
  const loud = new Float32Array(100).fill(0.4);
  const pcm = floatToPcm16(loud);
  assert.ok(pcm16Rms(pcm) > SILENCE_RMS);
  const b64 = pcm16ToBase64(pcm);
  const back = base64ToPcm16(b64);
  assert.equal(back.length, pcm.length);
  assert.equal(back[0], pcm[0]);
});

test('openai silence pad is 600 ms at 24 kHz', () => {
  const pad = openaiSilencePcm();
  assert.equal(pad.length, 14400);
  assert.equal(pad.byteLength, 28800);
});

test('CORS-style fetch failures are explained in Ukrainian', () => {
  const text = explainConnectError(new TypeError('Failed to fetch'), 'https://api.x.ai/v1/realtime/client_secrets');
  assert.match(text, /CORS/);
  assert.match(text, /api\.x\.ai/);
  const openai = explainConnectError(new TypeError('Failed to fetch'), 'https://api.openai.com/v1/live/sessions');
  assert.match(openai, /CORS/);
  assert.match(openai, /ключ/);
  const closed = explainWsClose(1006, '', 'wss://api.openai.com/v1/live/sessions');
  assert.match(closed, /1006/);
  assert.match(closed, /api\.openai\.com/);
});

test('xAI session is manual turn-taking at 24 kHz and Ukrainian', () => {
  const update = xaiSessionUpdate('Відповідай українською.');
  assert.equal(update.type, 'session.update');
  assert.equal(update.session.turn_detection, null);
  assert.equal(update.session.audio.input.format.rate, 24000);
  assert.equal(update.session.audio.input.transcription.language_hint, 'uk');
  assert.deepEqual(xaiEndMessages().map((m) => m.type), ['input_audio_buffer.commit', 'response.create']);
  assert.equal(xaiSubprotocol('tok'), 'xai-client-secret.tok');
});

test('OpenAI live body delegates to the chosen backend without an audio format', () => {
  const body = openaiLiveBody({
    model: 'gpt-live-1',
    instructions: 'Відповідай українською.',
    backend: 'gpt-6-astra',
    effort: 'medium',
    sdp: 'v=0',
  });
  assert.equal(body.session.model, 'gpt-live-1');
  assert.equal(body.session.audio, undefined);
  assert.equal(body.session.delegation.responses.model, 'gpt-6-astra');
  assert.equal(body.session.delegation.responses.reasoning.effort, 'medium');
  assert.equal(body.transport.type, 'webrtc');
  const start = openaiSessionStart({
    model: 'gpt-live-1',
    instructions: 'Відповідай українською.',
    backend: 'gpt-6-sol',
    effort: 'low',
  });
  assert.equal(start.type, 'session.start');
  assert.equal(start.session.audio.format.rate, 24000);
  assert.deepEqual(openaiWsProtocols('sk-test'), ['realtime', 'openai-insecure-api-key.sk-test']);
});

test('Gemini setup uses 16 kHz input and thinking only on the extended model', () => {
  const plain = geminiSetup({ model: 'gemini-3.8-live', instructions: 'Українською.', thinking: '' });
  assert.equal(plain.setup.model, 'models/gemini-3.8-live');
  assert.equal(plain.setup.generationConfig.thinkingConfig, undefined);
  assert.equal(plain.setup.systemInstruction.parts[0].text, 'Українською.');
  const thinking = geminiSetup({
    model: 'models/gemini-3.8-live-extended-thinking',
    instructions: 'Українською.',
    thinking: 'HIGH',
  });
  assert.equal(thinking.setup.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
  assert.equal(geminiAudioMessage('QQ==').realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  assert.equal(geminiEndMessage().realtimeInput.audioStreamEnd, true);
  assert.equal(
    geminiSocketUrl(GEMINI_WS_BETA, 'a b'),
    `${GEMINI_WS_BETA}?key=a%20b`,
  );
});

test('server events map onto audio, transcript, ready and done', () => {
  assert.equal(classifyEvent('xai', { type: 'response.output_audio.delta', delta: 'QQ==' }).type, 'audio');
  assert.equal(classifyEvent('xai', { type: 'response.done' }).type, 'done');
  assert.equal(classifyEvent('openai-live', { type: 'session.started' }).type, 'ready');
  assert.equal(classifyEvent('openai-live', { type: 'session.output_transcript.delta', delta: 'Привіт' }).text, 'Привіт');
  assert.equal(classifyEvent('openai-live', { type: 'response.event', event: { type: 'response.completed' } }).type, 'ignore');
  const gem = classifyEvent('gemini', {
    serverContent: {
      modelTurn: { parts: [{ inlineData: { data: 'QQ==' } }] },
      outputTranscription: { text: 'Так' },
      turnComplete: true,
      interactionStatus: 'IN_PROGRESS',
    },
  });
  assert.equal(gem.audios[0], 'QQ==');
  assert.equal(geminiTurnFinished('gemini', gem, 'HIGH'), false);
  assert.equal(geminiTurnFinished('gemini', { ...gem, interactionStatus: 'IDLE' }, 'HIGH'), true);
  assert.equal(geminiTurnFinished('gemini', gem, ''), true);
  assert.equal(looksLikeUnknownModel('The model grok-voice-3.0 was not found'), true);
  assert.equal(looksLikeUnknownModel('Incorrect API key provided'), false);
});
