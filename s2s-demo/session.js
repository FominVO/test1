import {
  GEMINI_WS_ALPHA,
  GEMINI_WS_BETA,
  OPENAI_LIVE_HTTP,
  OPENAI_LIVE_WS,
  XAI_CLIENT_SECRETS_URL,
  base64ToPcm16,
  classifyEvent,
  explainConnectError,
  explainWsClose,
  floatToPcm16,
  geminiAudioMessage,
  geminiEndMessage,
  geminiSetup,
  geminiSocketUrl,
  geminiTurnFinished,
  isNonSilent,
  looksLikeUnknownModel,
  openaiAppend,
  openaiLiveBody,
  openaiSessionStart,
  openaiSilencePcm,
  openaiWsProtocols,
  pcm16ToBase64,
  readHttpError,
  resampleLinear,
  xaiAppend,
  xaiEndMessages,
  xaiSessionUpdate,
  xaiSocketUrl,
  xaiSubprotocol,
} from './protocol.js';

const secretCache = new Map();

function parseMessageData(data) {
  if (typeof data === 'string') return JSON.parse(data);
  if (data instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(data);
    try {
      return JSON.parse(text);
    } catch {
      return { type: 'binary', pcm: new Int16Array(data) };
    }
  }
  return null;
}

async function postJson(url, key, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(explainConnectError(err, url));
  }
  if (!response.ok) throw await readHttpError(response, url);
  return response.json();
}

async function xaiClientSecret(key) {
  const cached = secretCache.get(key);
  if (cached && cached.exp > Date.now() + 5000) return cached.value;
  const data = await postJson(XAI_CLIENT_SECRETS_URL, key, { expires_after: { seconds: 300 } });
  if (!data || !data.value) throw new Error('xAI не повернув ephemeral-токен (поле value).');
  secretCache.set(key, { value: data.value, exp: Date.now() + 280000 });
  return data.value;
}

function waitForIce(pc, ms = 4000) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onState);
      resolve();
    }
    function onState() {
      if (pc.iceGatheringState === 'complete') done();
    }
    pc.addEventListener('icegatheringstatechange', onState);
  });
}

export function createPlayer(ctx) {
  let playAt = 0;
  return {
    enqueue(int16, sampleRate) {
      if (!int16 || !int16.length || ctx.state === 'closed') return;
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768;
      const buffer = ctx.createBuffer(1, floats.length, sampleRate);
      buffer.copyToChannel(floats, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      playAt = Math.max(playAt, ctx.currentTime + 0.02);
      source.start(playAt);
      playAt += buffer.duration;
    },
    remainingMs() {
      return Math.max(0, (playAt - ctx.currentTime) * 1000);
    },
  };
}

function targetRate(kind) {
  return kind === 'gemini' ? 16000 : 24000;
}

export function connectModel(model, opts) {
  const ctl = {
    closed: false,
    transport: '',
    usedModel: model.model,
    ready: null,
    sendFloat() {},
    setTalking() {},
    finish() {
      return Promise.resolve();
    },
    close() {
      ctl.closed = true;
    },
  };

  const player = opts.player;
  let utteranceClosed = false;
  let sawAudio = false;
  let finished = false;
  let silenceTimer = 0;
  let capTimer = 0;

  function fireDone() {
    if (finished || ctl.closed) return;
    finished = true;
    clearTimeout(silenceTimer);
    clearTimeout(capTimer);
    opts.onDone && opts.onDone();
  }

  function fireError(message) {
    if (ctl.closed) return;
    opts.onError && opts.onError(message);
    fireDone();
  }

  function noteAudio(int16, sampleRate) {
    if (!int16 || !int16.length) return;
    player.enqueue(int16, sampleRate || 24000);
    if (!isNonSilent(int16)) return;
    noteAudible();
  }

  function noteAudible() {
    sawAudio = true;
    opts.onAudible && opts.onAudible();
    if (utteranceClosed && model.kind !== 'xai') armSilence();
  }

  function armSilence() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (sawAudio) fireDone();
    }, 1600);
  }

  function armCap() {
    clearTimeout(capTimer);
    const ms = model.thinking ? 50000 : 35000;
    capTimer = setTimeout(() => {
      if (!finished) {
        opts.onStatus && opts.onStatus('Час очікування відповіді вичерпано');
        fireDone();
      }
    }, ms);
  }

  function handleClassified(kind, classified) {
    if (!classified || ctl.closed) return;
    if (classified.type === 'audio' && classified.b64) noteAudio(base64ToPcm16(classified.b64), 24000);
    else if (classified.type === 'transcript' && classified.text) {
      opts.onTranscript && opts.onTranscript(classified.role || 'assistant', classified.text);
    } else if (classified.type === 'error') fireError(classified.message);
    else if (classified.type === 'done') fireDone();
    else if (classified.type === 'content') {
      for (const b64 of classified.audios || []) noteAudio(base64ToPcm16(b64), 24000);
      if (classified.text) opts.onTranscript && opts.onTranscript('assistant', classified.text);
      if (geminiTurnFinished(kind, classified, model.thinking)) fireDone();
      else if (utteranceClosed && sawAudio && classified.turnComplete) armSilence();
    }
  }

  function markUtteranceClosed() {
    utteranceClosed = true;
    opts.onUtteranceClosed && opts.onUtteranceClosed();
    armCap();
    if (sawAudio && model.kind !== 'xai') armSilence();
  }

  if (model.kind === 'xai') ctl.ready = openXai(ctl, model, opts, handleClassified, markUtteranceClosed, fireError);
  else if (model.kind === 'openai-live') ctl.ready = openOpenAI(ctl, model, opts, handleClassified, markUtteranceClosed, fireError, noteAudible);
  else ctl.ready = openGemini(ctl, model, opts, handleClassified, markUtteranceClosed, fireError);
  return ctl;
}

export function forgetSecrets() {
  secretCache.clear();
}

function sendJson(ws, message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function openXai(ctl, model, opts, handleClassified, markUtteranceClosed, fireError) {
  const token = await xaiClientSecret(opts.key);
  const ids = [model.model];
  if (model.fallbackModel && model.fallbackModel !== model.model) ids.push(model.fallbackModel);
  let lastError = null;
  for (const modelId of ids) {
    try {
      const ws = await openXaiSocket(ctl, modelId, token, opts, handleClassified, markUtteranceClosed, fireError);
      ctl.usedModel = modelId;
      ctl.transport = 'WebSocket';
      if (modelId !== model.model) {
        opts.onStatus && opts.onStatus(`Модель ${model.model} відхилено, підключено ${modelId}`);
      }
      return ws;
    } catch (err) {
      lastError = err;
      if (ctl.closed) throw err;
      if (modelId === ids[ids.length - 1] || !looksLikeUnknownModel(err.message)) throw err;
      opts.onStatus && opts.onStatus(`${modelId} відхилено (${err.message}). Повтор із ${ids[ids.length - 1]}…`);
    }
  }
  throw lastError || new Error('Не вдалося підключити xAI');
}

function openXaiSocket(ctl, modelId, token, opts, handleClassified, markUtteranceClosed, fireError) {
  const url = xaiSocketUrl(modelId);
  return new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    let failed = false;
    try {
      ws = new WebSocket(url, [xaiSubprotocol(token)]);
    } catch (err) {
      reject(new Error(`Браузер відхилив підпротокол xAI: ${err.message}`));
      return;
    }
    const connectTimer = setTimeout(() => fail(new Error('Час очікування WebSocket xAI вичерпано')), 12000);
    const fail = (err) => {
      if (settled) return;
      settled = true;
      failed = true;
      clearTimeout(connectTimer);
      clearTimeout(ackTimer);
      try { ws.close(); } catch { /* already closing */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    let ackTimer = 0;
    ws.onopen = () => {
      sendJson(ws, xaiSessionUpdate(opts.instructions, opts.voice));
      ackTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimer);
          resolve(ws);
        }
      }, 800);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        if (ev.data instanceof ArrayBuffer) noteBinary(ev.data);
        return;
      }
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }
      const classified = classifyEvent('xai', event);
      if (!settled) {
        if (classified.type === 'error') {
          clearTimeout(ackTimer);
          fail(new Error(classified.message));
          return;
        }
        if (classified.type === 'ready') {
          clearTimeout(ackTimer);
          clearTimeout(connectTimer);
          settled = true;
          resolve(ws);
          return;
        }
      }
      handleClassified('xai', classified);
    };
    function noteBinary(buffer) {
      handleClassified('xai', { type: 'audio', b64: pcm16ToBase64(new Int16Array(buffer)) });
    }
    ws.onerror = () => {
      if (!settled) fail(new Error(explainWsClose(1006, '', url)));
    };
    ws.onclose = (ev) => {
      if (!settled) fail(new Error(explainWsClose(ev.code, ev.reason, url)));
      else if (!failed && !ctl.closed && ev.code !== 1000) fireError(explainWsClose(ev.code, ev.reason, url));
    };
    ctl.sendFloat = (float32, sampleRate) => {
      const pcm = resampleLinear(floatToPcm16(float32), sampleRate, targetRate('xai'));
      sendJson(ws, xaiAppend(pcm16ToBase64(pcm)));
    };
    ctl.finish = () => {
      for (const message of xaiEndMessages()) sendJson(ws, message);
      markUtteranceClosed();
      return Promise.resolve();
    };
    ctl.close = () => {
      ctl.closed = true;
      clearTimeout(connectTimer);
      clearTimeout(ackTimer);
      try { ws.close(); } catch { /* ignore */ }
    };
  });
}

async function openOpenAI(ctl, model, opts, handleClassified, markUtteranceClosed, fireError, noteAudible) {
  let webrtcError = null;
  try {
    await openOpenAIWebRTC(ctl, model, opts, handleClassified, markUtteranceClosed, fireError, noteAudible);
    ctl.transport = 'WebRTC';
    return;
  } catch (err) {
    if (ctl.closed) throw err;
    webrtcError = err;
    opts.onStatus && opts.onStatus(`WebRTC не вдалося: ${err.message}. Пробую WebSocket…`);
  }
  try {
    await openOpenAIWebSocket(ctl, model, opts, handleClassified, markUtteranceClosed, fireError);
    ctl.transport = 'WebSocket';
  } catch (err) {
    if (ctl.closed) throw err;
    throw new Error(`WebRTC: ${webrtcError ? webrtcError.message : 'не вдалося'}\nWebSocket: ${err.message}`);
  }
}

async function openOpenAIWebRTC(ctl, model, opts, handleClassified, markUtteranceClosed, fireError, noteAudible) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  let live = false;
  const abandon = () => {
    live = false;
    try { pc.close(); } catch { /* ignore */ }
  };
  try {
  const remote = new MediaStream();
  let sourceNode = null;
  pc.ontrack = (ev) => {
    remote.addTrack(ev.track);
    if (sourceNode) return;
    sourceNode = opts.audioContext.createMediaStreamSource(remote);
    const analyser = opts.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    sourceNode.connect(analyser);
    analyser.connect(opts.audioContext.destination);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (ctl.closed) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      if (Math.sqrt(sum / buf.length) >= 0.015) noteAudible();
      requestAnimationFrame(tick);
    };
    tick();
  };

  let micGain = null;
  const dest = opts.audioContext.createMediaStreamDestination();
  if (opts.mode === 'replay') {
    pc.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
  } else {
    const micSource = opts.micSource || opts.audioContext.createMediaStreamSource(opts.micStream);
    micGain = opts.audioContext.createGain();
    micGain.gain.value = 0;
    micSource.connect(micGain);
    micGain.connect(dest);
    pc.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
  }

  const events = pc.createDataChannel('oai-events');
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Час очікування session.started вичерпано')), 15000);
    events.onmessage = (ev) => {
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }
      const classified = classifyEvent('openai-live', event);
      if (classified.type === 'ready') {
        clearTimeout(timer);
        resolve();
      }
      if (live || classified.type === 'ready') handleClassified('openai-live', classified);
    };
    events.onclose = () => {
      if (live && !ctl.closed) fireError('Канал подій OpenAI закрито');
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed') return;
      if (!live) reject(new Error('WebRTC-з’єднання OpenAI не вдалося (стан failed)'));
      else fireError('WebRTC-з’єднання OpenAI перейшло в стан failed');
    };
  });
  started.catch(() => {});

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);
  const sdp = pc.localDescription && pc.localDescription.sdp;
  if (!sdp) throw new Error('Браузер не зібрав SDP-пропозицію');

  const result = await postJson(OPENAI_LIVE_HTTP, opts.key, openaiLiveBody({
    model: model.model,
    instructions: opts.instructions,
    backend: model.backend,
    effort: model.effort,
    voice: opts.voice,
    sdp,
  }));
  const answer = result && result.transport && result.transport.sdp;
  if (!answer) {
    throw new Error(`OpenAI не повернув transport.sdp: ${JSON.stringify(result).slice(0, 300)}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  await started;
  live = true;

  const queued = [];
  ctl.sendFloat = (float32) => {
    if (opts.mode === 'replay') queued.push(new Float32Array(float32));
  };
  ctl.finish = () => {
    if (opts.mode !== 'replay') {
      if (micGain) micGain.gain.value = 0;
      markUtteranceClosed();
      return Promise.resolve();
    }
    const rate = opts.sampleRate || opts.audioContext.sampleRate;
    let length = 0;
    for (const chunk of queued) length += chunk.length;
    const silence = Math.round(rate * 0.6);
    const merged = new Float32Array(length + silence);
    let offset = 0;
    for (const chunk of queued) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    if (!merged.length) {
      markUtteranceClosed();
      return Promise.resolve();
    }
    const buffer = opts.audioContext.createBuffer(1, merged.length, rate);
    buffer.copyToChannel(merged, 0);
    const src = opts.audioContext.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    return new Promise((resolve) => {
      src.onended = () => {
        markUtteranceClosed();
        resolve();
      };
      src.start();
    });
  };
  ctl.close = () => {
    ctl.closed = true;
    live = false;
    try { events.close(); } catch { /* ignore */ }
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.readyState !== 'ended') sender.track.stop();
    });
    pc.close();
    if (micGain) micGain.disconnect();
  };
  if (opts.mode !== 'replay') {
    ctl.sendFloat = () => {};
    ctl.setTalking = (on) => {
      if (micGain) micGain.gain.value = on ? 1 : 0;
    };
  }
  } catch (err) {
    abandon();
    throw err;
  }
}

function openOpenAIWebSocket(ctl, model, opts, handleClassified, markUtteranceClosed, fireError) {
  const url = OPENAI_LIVE_WS;
  return new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    let failed = false;
    try {
      ws = new WebSocket(url, openaiWsProtocols(opts.key));
    } catch (err) {
      reject(new Error(`Браузер відхилив підпротокол OpenAI: ${err.message}`));
      return;
    }
    const fail = (err) => {
      if (settled) return;
      settled = true;
      failed = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error('Час очікування session.started через WebSocket вичерпано')), 15000);
    ws.onopen = () => {
      sendJson(ws, openaiSessionStart({
        model: model.model,
        instructions: opts.instructions,
        backend: model.backend,
        effort: model.effort,
        voice: opts.voice,
      }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let event;
      try { event = JSON.parse(ev.data); } catch { return; }
      const classified = classifyEvent('openai-live', event);
      if (!settled && classified.type === 'ready') {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      if (!settled && classified.type === 'error') {
        clearTimeout(timer);
        fail(new Error(classified.message));
        return;
      }
      handleClassified('openai-live', classified);
    };
    ws.onerror = () => {
      if (!settled) fail(new Error(explainWsClose(1006, '', url)));
    };
    ws.onclose = (ev) => {
      if (!settled) fail(new Error(explainWsClose(ev.code, ev.reason, url)));
      else if (!failed && !ctl.closed && ev.code !== 1000) fireError(explainWsClose(ev.code, ev.reason, url));
    };
    ctl.sendFloat = (float32, sampleRate) => {
      const pcm = resampleLinear(floatToPcm16(float32), sampleRate, 24000);
      sendJson(ws, openaiAppend(pcm16ToBase64(pcm)));
    };
    ctl.finish = () => {
      const silence = openaiSilencePcm(24000, 0.6);
      sendJson(ws, openaiAppend(pcm16ToBase64(silence)));
      markUtteranceClosed();
      return Promise.resolve();
    };
    ctl.close = () => {
      ctl.closed = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    };
  });
}

async function openGemini(ctl, model, opts, handleClassified, markUtteranceClosed, fireError) {
  const bases = [opts.geminiWs || GEMINI_WS_BETA];
  if (bases[0].startsWith(GEMINI_WS_BETA) && GEMINI_WS_ALPHA !== bases[0]) bases.push(GEMINI_WS_ALPHA);
  let lastError = null;
  for (const base of bases) {
    try {
      await openGeminiSocket(ctl, model, opts, base, handleClassified, markUtteranceClosed, fireError);
      ctl.transport = 'WebSocket';
      ctl.usedModel = model.model;
      if (base !== bases[0]) opts.onStatus && opts.onStatus('Gemini відповіла на запасній версії протоколу v1alpha');
      return;
    } catch (err) {
      lastError = err;
      if (ctl.closed || base === bases[bases.length - 1]) throw err;
      opts.onStatus && opts.onStatus(`${err.message} Повтор через v1alpha…`);
    }
  }
  throw lastError || new Error('Не вдалося підключити Gemini');
}

function openGeminiSocket(ctl, model, opts, base, handleClassified, markUtteranceClosed, fireError) {
  const url = geminiSocketUrl(base, opts.key);
  const safeUrl = url.replace(/key=[^&]+/, 'key=…');
  return new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    let failed = false;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    const fail = (err) => {
      if (settled) return;
      settled = true;
      failed = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const timer = setTimeout(() => fail(new Error('Час очікування setupComplete Gemini вичерпано')), 12000);
    ws.onopen = () => {
      sendJson(ws, geminiSetup({
        model: model.model,
        instructions: opts.instructions,
        thinking: model.thinking,
        voice: opts.voice,
      }));
    };
    ws.onmessage = async (ev) => {
      let raw = ev.data;
      if (raw instanceof Blob) raw = await raw.text();
      let event = null;
      if (typeof raw === 'string') {
        try { event = JSON.parse(raw); } catch { return; }
      } else event = parseMessageData(raw);
      if (!event) return;
      const classified = classifyEvent('gemini', event);
      if (!settled && classified.type === 'ready') {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
      if (!settled && classified.type === 'error') {
        clearTimeout(timer);
        fail(new Error(classified.message));
        return;
      }
      handleClassified('gemini', classified);
    };
    ws.onerror = () => {
      if (!settled) fail(new Error(explainWsClose(1006, '', safeUrl)));
    };
    ws.onclose = (ev) => {
      if (!settled) fail(new Error(explainWsClose(ev.code, ev.reason, safeUrl)));
      else if (!failed && !ctl.closed && ev.code !== 1000) fireError(explainWsClose(ev.code, ev.reason, safeUrl));
    };
    ctl.sendFloat = (float32, sampleRate) => {
      const pcm = resampleLinear(floatToPcm16(float32), sampleRate, 16000);
      sendJson(ws, geminiAudioMessage(pcm16ToBase64(pcm)));
    };
    ctl.finish = () => {
      sendJson(ws, geminiEndMessage());
      markUtteranceClosed();
      return Promise.resolve();
    };
    ctl.close = () => {
      ctl.closed = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    };
  });
}
