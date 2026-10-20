import { useMemo, useState } from 'react';
import {
  clampWorkingTime,
  completeLevel,
  computeStars,
  dateForDay,
  dayNumber,
  eventToIcs,
  formatLong,
  formatWeekday,
  patchEntry,
  savePulse,
  saveReflection,
  scheduleEventDate,
  useBooster,
} from '../logic.js';
import { Art, C4, Dialog, downloadBlob } from '../ui.jsx';
import { Match3 } from './Match3.jsx';

export function LevelSheet({ level, content, rewards, state, act, onClose }) {
  const entry = state.progress[level.id] || {};
  const me = content.people.find((person) => person.id === content.currentUserId);
  const asOf = state.asOfOverride || content.meta.asOf;
  const dayNum = dayNumber(me.startDate, asOf);
  const durationMin = level.meeting?.durationMin || (level.type === 'pulse' ? 15 : 30);
  const nominalDate = typeof level.dueDay === 'number' ? dateForDay(me.startDate, level.dueDay) : asOf;
  const icsDate = typeof level.dueDay === 'number'
    ? scheduleEventDate(nominalDate, { buddyWeekly: Boolean(level.buddyWeekly) })
    : asOf;
  const eventTime = clampWorkingTime(level.buddyWeekly ? '16:00' : (level.meeting?.time || '10:00'), durationMin);
  const world = content.worlds.find((item) => item.id === level.worldId);
  const unlockLabel = level.worldId === 'horizon'
    ? formatLong(dateForDay(me.startDate, level.unlockDay || 365))
    : formatLong(dateForDay(me.startDate, world?.unlockDay || 1));
  const [reflection, setReflection] = useState(entry.reflection || '');
  const [answers, setAnswers] = useState({});
  const [quizScore, setQuizScore] = useState(entry.quizScore ?? null);
  const [error, setError] = useState('');
  const [pulse, setPulse] = useState({ tools: 4, productivity: 4, culture: 4 });
  const stars = computeStars(entry.completed ? { ...entry, reflection } : entry, rewards);
  const event = useMemo(() => ({
    id: level.id,
    title: level.title,
    date: icsDate,
    time: eventTime,
    durationMin,
    place: level.meeting?.place || 'За домовленістю',
    agenda: level.meeting?.agenda || level.summary,
  }), [level, icsDate, eventTime, durationMin]);

  function run(mutator) {
    const result = act(mutator);
    setError(result.ok ? '' : result.error || 'Не вийшло');
    return result;
  }

  function toggleCheck(index) {
    const checks = { ...(entry.checks || {}), [index]: !entry.checks?.[index] };
    act((prev) => ({ ok: true, state: patchEntry(prev, level.id, { checks }) }));
  }

  function openChapter(index) {
    const chapters = { ...(entry.chapters || {}), [index]: true };
    act((prev) => ({ ok: true, state: patchEntry(prev, level.id, { chapters }) }));
  }

  function submitQuiz() {
    const questions = level.questions || [];
    if (questions.some((_, index) => answers[index] == null)) {
      setError('Обери відповідь у кожному питанні');
      return;
    }
    const correct = questions.filter((question, index) => answers[index] === question.answer).length;
    const score = correct / questions.length;
    const best = Math.max(score, entry.quizScore || 0);
    setQuizScore(best);
    act((prev) => ({ ok: true, state: patchEntry(prev, level.id, { quizScore: best }) }));
    setError('');
  }

  function finish(score = quizScore) {
    run((prev) => completeLevel(prev, content, rewards, { levelId: level.id, quizScore: score, reflection }));
  }

  const reminded = !level.bonus && !entry.completed && typeof level.reminderDay === 'number' && dayNum >= level.reminderDay;
  const owned = state.boosters;

  return (
    <Dialog title={level.title} onClose={onClose} wide>
      <div className="sheet-meta">
        <Art id={`icons.${level.icon}`} alt="" className="sheet-icon" />
        <div>
          <p className="chips">
            <span className="chip">{C4[level.c4]}</span>
            {level.bonus && <span className="chip mint">Бонус</span>}
            {level.mandatory && <span className="chip berry">Обовʼязково</span>}
            {level.routine && <span className="chip">Рутина</span>}
            {level.overdue && <span className="chip berry">Дата минула</span>}
          </p>
          <p>{level.summary}</p>
        </div>
      </div>
      <ol className="ladder">
        {rewards.stars.ladder.map((rule) => (
          <li key={rule.id} className={stars >= rule.stars ? 'met' : ''}>
            <b>{rule.stars}</b> {rule.label}
          </li>
        ))}
      </ol>
      {level.locked && (
        <p className="banner">
          Цей крок відкриється {unlockLabel}. Або раніше, якщо набереш 70% зірок попереднього світу. Застрягти не можна.
        </p>
      )}
      {reminded && <p className="banner">Нагадування вже на календарі. Друга зірка за «без нагадувань» не нарахується, але високий квіз або рефлексія все ще дають зірки. Нічого не згорає.</p>}
      {!level.locked && level.type === 'reading' && level.paragraphs?.map((paragraph) => <p key={paragraph.slice(0, 24)}>{paragraph}</p>)}
      {!level.locked && level.type === 'video' && (
        <ol className="chapters">
          {level.chapters?.map((chapter, index) => (
            <li key={chapter.title}>
              <button type="button" className={entry.chapters?.[index] ? 'is-on' : ''} onClick={() => openChapter(index)}>
                {entry.chapters?.[index] ? 'Прочитано' : 'Відкрити'} · {chapter.title}
              </button>
              {entry.chapters?.[index] && <p>{chapter.body}</p>}
            </li>
          ))}
        </ol>
      )}
      {!level.locked && level.type === 'checklist' && (
        <ul className="checks">
          {level.items?.map((item, index) => (
            <li key={item}>
              <label>
                <input type="checkbox" checked={Boolean(entry.checks?.[index])} onChange={() => toggleCheck(index)} disabled={entry.completed} />
                {item}
              </label>
            </li>
          ))}
        </ul>
      )}
      {!level.locked && level.type === 'quiz' && (
        <div className="quiz">
          {level.questions?.map((question, index) => (
            <fieldset key={question.q}>
              <legend>{question.q}</legend>
              {question.choices.map((choice, choiceIndex) => (
                <label key={choice}>
                  <input
                    type="radio"
                    name={`q-${index}`}
                    checked={answers[index] === choiceIndex}
                    onChange={() => setAnswers((prev) => ({ ...prev, [index]: choiceIndex }))}
                  />
                  {choice}
                </label>
              ))}
            </fieldset>
          ))}
          <button type="button" className="btn secondary" onClick={submitQuiz}>Перевірити</button>
          {quizScore != null && <p>Результат: {Math.round(quizScore * 100)}%. Можна перескласти і залишити кращий.</p>}
        </div>
      )}
      {!level.locked && level.type === 'pulse' && (
        <div className="pulse-form">
          {[
            ['tools', 'Інструменти'],
            ['productivity', 'Продуктивність'],
            ['culture', 'Культура'],
          ].map(([key, label]) => (
            <fieldset key={key}>
              <legend>{label}</legend>
              <div className="scale">
                {[1, 2, 3, 4, 5].map((value) => (
                  <label key={value}>
                    <input type="radio" name={key} checked={pulse[key] === value} onChange={() => setPulse((prev) => ({ ...prev, [key]: value }))} />
                    {value}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p className="quiet">Низька оцінка не знімає зірки. HR бачить осі, колеги на мапі — ні.</p>
        </div>
      )}
      {!level.locked && (level.type === 'meeting' || level.meeting) && (
        <div className="meeting-card">
          <p><b>{formatWeekday(event.date)} · {event.time}</b> · {event.durationMin} хв</p>
          <p>{level.meeting?.place}</p>
          <p>{level.meeting?.agenda || level.summary}</p>
          {event && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => downloadBlob(`${level.id}.ics`, eventToIcs(event), 'text/calendar')}
            >
              Додати в календар
            </button>
          )}
        </div>
      )}
      {!level.locked && level.type === 'match3' && !entry.completed && (
        <Match3 target={level.match?.target || 300} moves={level.match?.moves || 16} onWin={(score) => {
          setQuizScore(score);
          act((prev) => ({ ok: true, state: patchEntry(prev, level.id, { quizScore: score }) }));
        }} />
      )}
      {(entry.reveals?.hint || false) && <p className="banner mint">{level.hint}</p>}
      {entry.reveals?.expert && level.expert && (
        <p className="banner mint"><b>{level.expert.name}</b> · {level.expert.role}<br />{level.expert.channel}</p>
      )}
      {!level.locked && (
        <div className="booster-row">
          <button type="button" className="btn tiny" disabled={!owned.hint} onClick={() => run((prev) => useBooster(prev, content, rewards, { levelId: level.id, boosterId: 'hint' }))}>Підказка · {owned.hint || 0}</button>
          <button type="button" className="btn tiny" disabled={!owned.expert} onClick={() => run((prev) => useBooster(prev, content, rewards, { levelId: level.id, boosterId: 'expert' }))}>Експерт · {owned.expert || 0}</button>
          {level.routine && <button type="button" className="btn tiny" disabled={!owned.skip || entry.completed} onClick={() => run((prev) => useBooster(prev, content, rewards, { levelId: level.id, boosterId: 'skip' }))}>Пропустити рутину · {owned.skip || 0}</button>}
        </div>
      )}
      <label className="block">
        Коротка рефлексія для третьої зірки
        <textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={3} maxLength={400} />
      </label>
      <p className="quiet">{reflection.trim().length} / {rewards.stars.reflectionMinChars} символів</p>
      {error && <p className="banner berry" role="alert">{error}</p>}
      <div className="sheet-actions">
        {!entry.completed && !level.locked && level.type === 'pulse' && (
          <button type="button" className="btn" onClick={() => run((prev) => savePulse(prev, content, rewards, { personId: content.currentUserId, levelId: level.id, wave: level.wave, ...pulse, comment: reflection }))}>Надіслати пульс</button>
        )}
        {!entry.completed && !level.locked && level.type !== 'pulse' && (
          <button type="button" className="btn" onClick={() => finish()}>Закрити рівень</button>
        )}
        {entry.completed && (
          <button type="button" className="btn secondary" onClick={() => run((prev) => saveReflection(prev, rewards, { levelId: level.id, reflection }))}>Зберегти рефлексію</button>
        )}
      </div>
    </Dialog>
  );
}
