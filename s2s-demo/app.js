import {
  BACKEND_PRESETS,
  CUSTOM_OPTION,
  EFFORT_OPTIONS,
  GEMINI_WS_ALPHA,
  GEMINI_WS_BETA,
  INSTRUCTIONS_DEFAULT,
  MODEL_ID_PRESETS,
  MODELS,
  PROVIDERS,
  THINKING_OPTIONS,
  VOICE_PRESETS,
} from './protocol.js';
import { connectModel, createPlayer, forgetSecrets } from './session.js';

const STORAGE_KEY = 's2s-demo-v1';
const $ = (id) => document.getElementById(id);

const state = load();
const models = MODELS.map((model) => ({ ...model, ...(state.models[model.id] || {}) }));
let selected = models.find((model) => model.id === state.selectedId) || models[0];
let ctx = null;
let micStream = null;
let micPromise = null;
let micSource = null;
let processor = null;
let silentGain = null;
let player = null;
let active = null;
let holding = false;
let recording = false;
let compareChunks = [];
let cancelCompare = false;
let sampleRate = 48000;

const statusEl = $('status');
const logEl = $('log');

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      keys: { xai: '', openai: '', gemini: '', ...(saved.keys || {}) },
      models: saved.models || {},
      instructions: saved.instructions || INSTRUCTIONS_DEFAULT,
      geminiWs: saved.geminiWs || GEMINI_WS_BETA,
      selectedId: saved.selectedId || '',
      compareIds: Array.isArray(saved.compareIds) ? saved.compareIds : null,
    };
  } catch {
    return {
      keys: { xai: '', openai: '', gemini: '' },
      models: {},
      instructions: INSTRUCTIONS_DEFAULT,
      geminiWs: GEMINI_WS_BETA,
      selectedId: '',
      compareIds: null,
    };
  }
}

function save() {
  const modelsState = {};
  for (const model of models) {
    modelsState[model.id] = {
      model: model.model,
      backend: model.backend,
      effort: model.effort,
      thinking: model.thinking,
      voice: model.voice,
    };
  }
  const compare = $('pick-compare');
  state.compareIds = compare ? [...compare.selectedOptions].map((option) => option.value) : state.compareIds;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    keys: state.keys,
    models: modelsState,
    instructions: state.instructions,
    geminiWs: state.geminiWs,
    selectedId: selected ? selected.id : '',
    compareIds: state.compareIds,
  }));
}

function hasKey(model) {
  return !!String(state.keys[model.key] || '').trim();
}

function setStatus(text) {
  statusEl.textContent = text;
}

function renderAa() {
  const body = $('aa');
  for (const model of models) {
    const tr = document.createElement('tr');
    for (const value of [model.rank, model.name, model.provider, Number(model.index).toFixed(1), model.ttfa == null ? 'н/д' : Number(model.ttfa).toFixed(2), model.price]) {
      const td = document.createElement('td');
      td.textContent = String(value);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function providerKey(model) {
  return model.key;
}

function presetsFor(model) {
  return MODEL_ID_PRESETS[providerKey(model)] || [];
}

function voicesFor(model) {
  return VOICE_PRESETS[providerKey(model)] || [];
}

function fillPresetSelect(select, presets, current) {
  select.replaceChildren();
  for (const value of presets) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  }
  const custom = document.createElement('option');
  custom.value = CUSTOM_OPTION;
  custom.textContent = 'власний';
  select.appendChild(custom);
  select.value = presets.includes(current) ? current : CUSTOM_OPTION;
  return select.value === CUSTOM_OPTION;
}

function option(select, value, label) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  select.appendChild(node);
  return node;
}

function modelsForProvider(providerId) {
  return models.filter((model) => model.key === providerId);
}

function modelLabel(model) {
  const key = hasKey(model) ? 'ключ є' : 'немає ключа';
  return `${model.rank} · ${model.name} — ${key}`;
}

function refreshModelOptions() {
  const providerId = $('pick-provider').value;
  const select = $('pick-model');
  const current = selected && selected.key === providerId ? selected.id : '';
  select.replaceChildren();
  for (const model of modelsForProvider(providerId)) option(select, model.id, modelLabel(model));
  if ([...select.options].some((item) => item.value === current)) select.value = current;
  else if (select.options.length) select.value = select.options[0].value;
}

function refreshCompareOptions() {
  const select = $('pick-compare');
  const chosen = new Set(state.compareIds || models.map((model) => model.id));
  select.replaceChildren();
  for (const model of models) {
    const node = option(select, model.id, modelLabel(model));
    node.selected = chosen.has(model.id);
  }
}

function showChoiceError(model, text) {
  if (selected && model && model.id === selected.id) $('model-error').textContent = text || '';
}

function applySelection(announce) {
  selected = models.find((model) => model.id === $('pick-model').value) || models[0];
  const voiceSelect = $('pick-voice');
  const customVoice = fillPresetSelect(voiceSelect, voicesFor(selected), selected.voice);
  $('voice-custom-wrap').hidden = !customVoice;
  $('voice-custom').value = customVoice ? selected.voice : '';
  const openai = selected.kind === 'openai-live';
  const gemini = selected.kind === 'gemini';
  $('effort-wrap').hidden = !openai;
  $('thinking-wrap').hidden = !gemini;
  if (openai) $('pick-effort').value = EFFORT_OPTIONS.includes(selected.effort) ? selected.effort : 'medium';
  if (gemini) $('pick-thinking').value = selected.thinking || '';
  const ttfa = selected.ttfa == null ? 'н/д' : Number(selected.ttfa).toFixed(2);
  $('model-meta').textContent = `${selected.provider} · id ${selected.model} · індекс ${Number(selected.index).toFixed(1)} · TTFA ${ttfa} с · ${selected.price} · ${hasKey(selected) ? 'ключ є' : 'немає ключа'}`;
  $('model-note').textContent = selected.note || '';
  if (announce) setStatus(hasKey(selected) ? `Готово: ${selected.name}` : 'немає ключа');
  save();
}

function initChoices() {
  const providerSelect = $('pick-provider');
  for (const provider of PROVIDERS) option(providerSelect, provider.id, provider.label);
  providerSelect.value = selected.key;
  providerSelect.addEventListener('change', () => {
    refreshModelOptions();
    applySelection(true);
  });
  $('pick-model').addEventListener('change', () => applySelection(true));
  $('pick-voice').addEventListener('change', () => {
    const custom = $('pick-voice').value === CUSTOM_OPTION;
    $('voice-custom-wrap').hidden = !custom;
    if (!custom) {
      selected.voice = $('pick-voice').value;
      save();
    } else if (!$('voice-custom').value) {
      $('voice-custom').value = selected.voice || '';
    }
  });
  $('voice-custom').addEventListener('input', () => {
    selected.voice = $('voice-custom').value.trim();
    save();
  });
  const effort = $('pick-effort');
  for (const value of EFFORT_OPTIONS) option(effort, value, value);
  effort.addEventListener('change', () => {
    selected.effort = effort.value;
    save();
  });
  const thinking = $('pick-thinking');
  for (const item of THINKING_OPTIONS) option(thinking, item.value, item.label);
  thinking.addEventListener('change', () => {
    selected.thinking = thinking.value;
    save();
  });
  $('pick-compare').addEventListener('change', save);
  refreshModelOptions();
  refreshCompareOptions();
  applySelection(false);
  buildIdSettings();
}

function buildIdSettings() {
  const root = $('id-settings');
  root.replaceChildren();
  for (const provider of PROVIDERS) {
    const group = document.createElement('fieldset');
    group.className = 'id-group';
    const legend = document.createElement('legend');
    legend.textContent = provider.label;
    group.appendChild(legend);
    for (const model of modelsForProvider(provider.id)) {
      group.appendChild(idControl(`Ідентифікатор · ${model.name}`, presetsFor(model), model.model, (value) => {
        model.model = value;
        if (selected === model) applySelection(false);
        else save();
      }));
      if (model.kind === 'openai-live') {
        group.appendChild(idControl('Бекенд делегування', BACKEND_PRESETS, model.backend, (value) => {
          model.backend = value;
          save();
        }));
      }
    }
    root.appendChild(group);
  }
}

function idControl(label, presets, current, onValue) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const select = document.createElement('select');
  const custom = document.createElement('input');
  custom.autocomplete = 'off';
  custom.spellcheck = false;
  const useCustom = fillPresetSelect(select, presets, current);
  custom.hidden = !useCustom;
  custom.value = useCustom ? current : '';
  let lastPreset = presets.includes(current) ? current : '';
  select.addEventListener('change', () => {
    const isCustom = select.value === CUSTOM_OPTION;
    custom.hidden = !isCustom;
    if (!isCustom) {
      lastPreset = select.value;
      onValue(select.value);
    } else {
      if (!custom.value.trim()) custom.value = lastPreset;
      onValue(custom.value.trim());
    }
  });
  custom.addEventListener('input', () => onValue(custom.value.trim()));
  wrap.append(select, custom);
  return wrap;
}

function compareModels() {
  const ids = new Set([...$('pick-compare').selectedOptions].map((option) => option.value));
  return models.filter((model) => ids.has(model.id) && hasKey(model));
}

function addRow(model, transcript, err) {
  const tr = document.createElement('tr');
  const values = [
    `${model.name}${model._transport ? ` (${model._transport})` : ''}`,
    String(model.index),
    model.ttfa ?? 'н/д',
    err ? '—' : (model._lat ?? '—'),
    model.price,
    err || transcript || '(лише аудіо)',
  ];
  for (const value of values) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.appendChild(td);
  }
  $('res').prepend(tr);
}

function primeAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    sampleRate = ctx.sampleRate;
    player = createPlayer(ctx);
  }
  const resume = ctx.resume();
  if (!micPromise) {
    micPromise = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  }
  return resume;
}

async function ensureAudio() {
  await primeAudio();
  if (!micStream) {
    micStream = await micPromise;
    micSource = ctx.createMediaStreamSource(micStream);
    processor = ctx.createScriptProcessor(2048, 1, 1);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    micSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      $('level').style.width = `${Math.min(100, rms * 280)}%`;
      if (processor._onChunk) processor._onChunk(input);
    };
  }
}

function startChunks(onChunk) {
  processor._onChunk = (input) => {
    const copy = new Float32Array(input.length);
    copy.set(input);
    onChunk(copy);
  };
}

function stopChunks() {
  if (processor) processor._onChunk = null;
  $('level').style.width = '0';
}

function closeActive() {
  if (active) {
    active.close();
    active = null;
  }
}

function runTurn(model, mode) {
  const assistant = { text: '' };
  const user = { text: '' };
  let turnError = '';
  let latched = false;
  model._lat = null;
  model._transport = '';
  showChoiceError(model, '');
  logEl.textContent = 'Підключення…';
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const ctl = connectModel(model, {
    key: state.keys[model.key].trim(),
    instructions: state.instructions,
    geminiWs: state.geminiWs,
    voice: model.voice,
    mode,
    audioContext: ctx,
    micStream,
    micSource,
    sampleRate,
    player,
    onStatus: setStatus,
    onTranscript: (role, text) => {
      if (role === 'user') user.text += text;
      else assistant.text += text;
      logEl.textContent = `${user.text ? `Ви: ${user.text}\n` : ''}${assistant.text}`;
    },
    onAudible: () => {
      if (latched || !model._tEnd) return;
      latched = true;
      model._lat = ((performance.now() - model._tEnd) / 1000).toFixed(2);
      setStatus(`Перший звук через ${model._lat} с`);
    },
    onUtteranceClosed: () => { model._tEnd = performance.now(); },
    onError: (message) => {
      turnError = message;
      showChoiceError(model, message);
      setStatus(`Помилка: ${message}`);
    },
    onDone: () => resolveDone(),
  });
  active = ctl;
  return {
    ctl,
    done,
    result: () => ({ transcript: assistant.text, error: turnError }),
  };
}

async function finishPlayback() {
  const wait = player ? player.remainingMs() + 250 : 250;
  await new Promise((resolve) => setTimeout(resolve, wait));
}

const mic = $('mic');
let sawPointer = false;
async function pressMic(event) {
  if (event.type === 'mousedown' && sawPointer) return;
  if (event.type === 'pointerdown') sawPointer = true;
  event.preventDefault();
  if (recording || holding) return;
  if (!selected) return setStatus('Спершу оберіть модель');
  if (!hasKey(selected)) return setStatus('немає ключа');
  holding = true;
  mic.classList.add('rec');
  try { mic.setPointerCapture(event.pointerId); } catch { /* вказівник уже відпущено */ }
  primeAudio();
  setStatus('Підключаюсь…');
  try {
    await ensureAudio();
    closeActive();
    const turn = runTurn(selected, 'mic');
    await turn.ctl.ready;
    if (!holding) {
      turn.ctl.close();
      return;
    }
    selected._transport = turn.ctl.transport;
    selected._tEnd = 0;
    if (turn.ctl.transport === 'WebRTC') turn.ctl.setTalking(true);
    else startChunks((chunk) => turn.ctl.sendFloat(chunk, sampleRate));
    setStatus('Слухаю… відпустіть, коли закінчите');
    mic._turn = turn;
  } catch (err) {
    holding = false;
    mic.classList.remove('rec');
    const message = err.message || String(err);
    showChoiceError(selected, message);
    setStatus(`Помилка: ${message}`);
    addRow(selected, '', message);
    closeActive();
  }
}
mic.addEventListener('pointerdown', pressMic);
mic.addEventListener('mousedown', pressMic);

async function releaseMic() {
  sawPointer = false;
  if (!holding) return;
  holding = false;
  mic.classList.remove('rec');
  stopChunks();
  const turn = mic._turn;
  mic._turn = null;
  if (!turn) return;
  if (turn.ctl.transport === 'WebRTC') turn.ctl.setTalking(false);
  setStatus('Чекаю відповідь…');
  await turn.ctl.finish();
  await turn.done;
  await finishPlayback();
  const { transcript, error } = turn.result();
  addRow(selected, transcript, error);
  if (!error) setStatus(selected._lat ? `Перший звук через ${selected._lat} с` : 'Відповідь завершено');
  closeActive();
}

mic.addEventListener('pointerup', releaseMic);
mic.addEventListener('pointercancel', releaseMic);
mic.addEventListener('mouseup', releaseMic);
window.addEventListener('mouseup', releaseMic);
mic.addEventListener('contextmenu', (event) => event.preventDefault());

const cmp = $('cmp');
cmp.addEventListener('click', async () => {
  if (holding) return;
  if (!recording) {
    primeAudio();
    try {
      await ensureAudio();
    } catch (err) {
      setStatus(`Немає доступу до мікрофона: ${err.message || err}`);
      return;
    }
    compareChunks = [];
    recording = true;
    cancelCompare = false;
    cmp.textContent = '⏹ Зупинити запис і запустити';
    startChunks((chunk) => compareChunks.push(chunk));
    setStatus('Записую запит…');
    return;
  }
  recording = false;
  stopChunks();
  cmp.textContent = '🔁 Порівняти: один запит → обрані моделі';
  const list = compareModels();
  if (!list.length) return setStatus('Немає обраних моделей із ключем');
  if (!compareChunks.length) return setStatus('Запис порожній');
  $('cancel').hidden = false;
  cmp.disabled = true;
  mic.disabled = true;
  for (const model of list) {
    if (cancelCompare) break;
    setStatus(`Тестую ${model.name}…`);
    closeActive();
    const turn = runTurn(model, 'replay');
    try {
      await turn.ctl.ready;
      model._transport = turn.ctl.transport;
      model._tEnd = 0;
      for (const chunk of compareChunks) turn.ctl.sendFloat(chunk, sampleRate);
      await turn.ctl.finish();
      await turn.done;
      await finishPlayback();
      const { transcript, error } = turn.result();
      addRow(model, transcript, error);
    } catch (err) {
      const message = err.message || String(err);
      showChoiceError(model, message);
      addRow(model, '', message);
    } finally {
      closeActive();
    }
  }
  $('cancel').hidden = true;
  cmp.disabled = false;
  mic.disabled = false;
  setStatus(cancelCompare ? 'Порівняння скасовано' : 'Порівняння завершено');
});

$('cancel').addEventListener('click', () => {
  cancelCompare = true;
  setStatus('Скасовую після поточної моделі…');
});

$('settings-toggle').addEventListener('click', () => {
  const panel = $('settings');
  panel.hidden = !panel.hidden;
  $('settings-toggle').setAttribute('aria-expanded', String(!panel.hidden));
});

function bindKey(id, name) {
  const input = $(id);
  input.value = state.keys[name];
  input.addEventListener('input', () => {
    state.keys[name] = input.value;
    save();
    refreshModelOptions();
    refreshCompareOptions();
    applySelection(false);
    if (!holding && !recording) {
      if (selected && !hasKey(selected)) setStatus('немає ключа');
      else if (selected && selected.key === name) setStatus(`Готово: ${selected.name}`);
    }
  });
}

bindKey('key-xai', 'xai');
bindKey('key-openai', 'openai');
bindKey('key-gemini', 'gemini');

let keysVisible = false;
$('toggle-keys').addEventListener('click', () => {
  keysVisible = !keysVisible;
  for (const id of ['key-xai', 'key-openai', 'key-gemini']) $(id).type = keysVisible ? 'text' : 'password';
  $('toggle-keys').textContent = keysVisible ? 'Сховати ключі' : 'Показати ключі';
});

$('clear-keys').addEventListener('click', () => {
  state.keys = { xai: '', openai: '', gemini: '' };
  forgetSecrets();
  for (const id of ['key-xai', 'key-openai', 'key-gemini']) $(id).value = '';
  save();
  refreshModelOptions();
  refreshCompareOptions();
  applySelection(false);
  setStatus('Ключі очищено');
});

$('instructions').value = state.instructions;
$('instructions').addEventListener('input', () => {
  state.instructions = $('instructions').value;
  save();
});

const geminiSelect = $('gemini-ws');
for (const [value, label] of [[GEMINI_WS_BETA, 'v1beta (як у підключенні Live)'], [GEMINI_WS_ALPHA, 'v1alpha (як у гіді Thinking)']]) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  if (value === state.geminiWs) option.selected = true;
  geminiSelect.appendChild(option);
}
geminiSelect.addEventListener('change', () => {
  state.geminiWs = geminiSelect.value;
  save();
});

renderAa();
initChoices();
