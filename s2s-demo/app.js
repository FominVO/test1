import {
  GEMINI_WS_ALPHA,
  GEMINI_WS_BETA,
  INSTRUCTIONS_DEFAULT,
  MODELS,
} from './protocol.js';
import { connectModel, createPlayer, forgetSecrets } from './session.js';

const STORAGE_KEY = 's2s-demo-v1';
const $ = (id) => document.getElementById(id);

const state = load();
const models = MODELS.map((model) => ({ ...model, ...(state.models[model.id] || {}) }));
let selected = null;
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
    };
  } catch {
    return { keys: { xai: '', openai: '', gemini: '' }, models: {}, instructions: INSTRUCTIONS_DEFAULT, geminiWs: GEMINI_WS_BETA };
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
    };
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    keys: state.keys,
    models: modelsState,
    instructions: state.instructions,
    geminiWs: state.geminiWs,
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

function renderCards() {
  const root = $('models');
  root.replaceChildren();
  for (const model of models) {
    const card = document.createElement('article');
    card.className = 'card' + (hasKey(model) ? '' : ' off') + (selected === model ? ' sel' : '');
    card.tabIndex = 0;

    const top = document.createElement('div');
    top.className = 'card-top';
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = model.rank;
    const title = document.createElement('b');
    title.textContent = model.name;
    top.append(rank, title);

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${model.provider} · індекс ${Number(model.index).toFixed(1)} · TTFA ${model.ttfa == null ? 'н/д' : Number(model.ttfa).toFixed(2)} с · ${model.price}`;

    const tag = document.createElement('div');
    tag.className = 'tag' + (hasKey(model) ? ' ok' : '');
    tag.textContent = hasKey(model) ? 'ключ є' : 'немає ключа';

    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'Id моделі';
    const modelInput = document.createElement('input');
    modelInput.value = model.model;
    modelInput.spellcheck = false;
    modelInput.addEventListener('click', (event) => event.stopPropagation());
    modelInput.addEventListener('input', () => {
      model.model = modelInput.value.trim();
      save();
    });
    modelLabel.appendChild(modelInput);

    card.append(top, meta, tag, modelLabel);

    if (model.kind === 'openai-live') {
      const backend = field('Бекенд делегування', model.backend, (value) => { model.backend = value; save(); });
      const effort = selectField('Зусилля', ['low', 'medium', 'high', 'xhigh', 'none', 'minimal'], model.effort, (value) => {
        model.effort = value;
        save();
      });
      card.append(backend, effort);
    }
    if (model.kind === 'gemini') {
      const thinking = selectField('Thinking', ['', 'LOW', 'MEDIUM', 'HIGH'], model.thinking || '', (value) => {
        model.thinking = value;
        save();
      });
      card.appendChild(thinking);
    }
    if (model.note) {
      const note = document.createElement('details');
      note.className = 'hint';
      const summary = document.createElement('summary');
      summary.textContent = 'Який id моделі';
      const text = document.createElement('p');
      text.textContent = model.note;
      note.append(summary, text);
      note.addEventListener('click', (event) => event.stopPropagation());
      card.appendChild(note);
    }
    const err = document.createElement('p');
    err.className = 'err';
    err.dataset.err = model.id;
    card.appendChild(err);

    const choose = () => {
      selected = model;
      document.querySelectorAll('.card').forEach((node) => node.classList.remove('sel'));
      card.classList.add('sel');
      setStatus(hasKey(model) ? `Готово: ${model.name}` : 'немає ключа');
    };
    card.addEventListener('click', choose);
    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });
    root.appendChild(card);
  }
}

function field(label, value, onInput) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  input.value = value || '';
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('input', () => onInput(input.value.trim()));
  wrap.appendChild(input);
  return wrap;
}

function selectField(label, values, current, onChange) {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const select = document.createElement('select');
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'вимкнено';
    if (value === current) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('click', (event) => event.stopPropagation());
  select.addEventListener('change', () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

function cardError(model, text) {
  const node = document.querySelector(`[data-err="${model.id}"]`);
  if (node) node.textContent = text || '';
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
  cardError(model, '');
  logEl.textContent = 'Підключення…';
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const ctl = connectModel(model, {
    key: state.keys[model.key].trim(),
    instructions: state.instructions,
    geminiWs: state.geminiWs,
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
      cardError(model, message);
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
    cardError(selected, message);
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
  cmp.textContent = '🔁 Порівняти: один запит → усі моделі з ключем';
  const list = models.filter(hasKey);
  if (!list.length) return setStatus('Немає жодного ключа для порівняння');
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
      cardError(model, message);
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
    renderCards();
    if (selected && !hasKey(selected)) setStatus('немає ключа');
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
  renderCards();
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
renderCards();
