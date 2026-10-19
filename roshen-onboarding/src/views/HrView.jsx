import { useState } from 'react';
import { addDays, computeStars, confirmStar, formatLong, giveBooster, pulseAverages } from '../logic.js';
import { PULSE_AXES } from '../logic.js';
import { downloadBlob } from '../ui.jsx';

const AXIS_COLOR = { tools: '#5C3A21', productivity: '#C4842A', culture: '#0F7A5C' };

export function HrView({ model, content, rewards, state, act, saveContent, saveRewards }) {
  const [selected, setSelected] = useState(content.currentUserId);
  const [note, setNote] = useState('');
  const snap = model.snapshots.find((item) => item.person.id === selected) || model.snapshots[0];
  const ordered = [...model.snapshots].sort((a, b) => b.person.startDate.localeCompare(a.person.startDate));

  function prep(actionId, value) {
    act((prev) => ({
      ok: true,
      state: {
        ...prev,
        managerPrep: {
          ...prev.managerPrep,
          [snap.person.id]: { ...(prev.managerPrep[snap.person.id] || {}), [actionId]: value },
        },
      },
    }));
  }

  function readFile(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result));
        if (kind === 'content' && Array.isArray(json.levels) && Array.isArray(json.people)) {
          saveContent(json);
          setNote('Контент замінено в цьому браузері. Щоб побачили всі, закомітьте файл у репозиторій.');
        } else if (kind === 'rewards' && json.stars && json.worldGate) {
          saveRewards(json);
          setNote('Економіку замінено в цьому браузері.');
        } else setNote('У файлі не вистачає полів.');
      } catch {
        setNote('Це не JSON.');
      }
    };
    reader.readAsText(file);
  }

  const pending = content.levels.filter((level) => snap.progress[level.id]?.completed && computeStars(snap.progress[level.id], rewards) < 3);

  return (
    <div className="hr">
      <section className="card hr-head">
        <div>
          <p className="eyebrow">Кабінет керівника і HR</p>
          <h2>Когорта адаптації</h2>
          <p>Прогрес, прострочені кроки і сигнали. Без публічного рейтингу швидкості.</p>
        </div>
        <div className="date-stepper">
          <button type="button" className="btn tiny" onClick={() => act((prev) => ({ ok: true, state: { ...prev, asOfOverride: addDays(model.asOf, -1) } }))}>− день</button>
          <p>Демо-дата<br /><b>{formatLong(model.asOf)}</b></p>
          <button type="button" className="btn tiny" onClick={() => act((prev) => ({ ok: true, state: { ...prev, asOfOverride: addDays(model.asOf, 1) } }))}>+ день</button>
          <button type="button" className="btn tiny ghost" onClick={() => act((prev) => ({ ok: true, state: { ...prev, asOfOverride: null } }))}>Скинути дату</button>
        </div>
      </section>
      <PulseChart snapshots={model.snapshots} />
      <div className="hr-grid">
        <ul className="hire-list">
          {ordered.map((item) => (
            <li key={item.person.id}>
              <button type="button" className={item.person.id === snap.person.id ? 'is-on' : ''} onClick={() => setSelected(item.person.id)}>
                <span>
                  <b>{item.person.name}</b>
                  <span className="quiet">{item.person.role} · день {item.dayNum}</span>
                </span>
                <span className="hire-meta">
                  <span>{item.percent}%</span>
                  {item.flags.filter((flag) => flag.severity === 'high').length > 0 && <span className="flag high">увага</span>}
                  {item.overdue.length > 0 && <span className="flag watch">{item.overdue.length}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <section className="card hire-detail">
          <p className="eyebrow">{snap.person.department} · {snap.person.site}</p>
          <h2>{snap.person.name}</h2>
          <p>{snap.person.role}. Старт {formatLong(snap.person.startDate)}. Buddy: {snap.buddy?.name || 'ще немає'}. Керівник: {snap.manager?.name || 'ще немає'}.</p>
          <div className="bar" role="meter" aria-label="Прогрес програми" aria-valuenow={snap.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${snap.percent}%` }} /></div>
          <p className="quiet">Зірки {snap.stars}/{snap.starsMax} · зустрічі з buddy {snap.buddies.done}/{snap.buddies.total}</p>
          {snap.flags.length > 0 && (
            <ul className="flags">
              {snap.flags.map((flag) => <li key={flag.id} className={flag.severity}>{flag.text}</li>)}
            </ul>
          )}
          <h3>Рівень 0 керівника</h3>
          <p className="quiet">Пʼять дій до дня 1. Це чекліст Google-патерну, не рівень на мапі новачка.</p>
          <ul className="checks">
            {content.managerLevel0.map((action) => (
              <li key={action.id}>
                <label>
                  <input type="checkbox" checked={Boolean(snap.prep[action.id])} onChange={(event) => prep(action.id, event.target.checked)} />
                  <span><b>{action.title}</b><br />{action.detail}</span>
                </label>
              </li>
            ))}
          </ul>
          <h3>Прострочені кроки</h3>
          {snap.overdue.length === 0 ? <p className="quiet">Немає.</p> : (
            <ul>{snap.overdue.map((level) => <li key={level.id}>{level.title}</li>)}</ul>
          )}
          <h3>Підтвердити зірку</h3>
          <p className="quiet">Buddy або керівник підтверджує якість. Це третя зірка, не оцінка швидкості.</p>
          {pending.length === 0 ? <p className="quiet">Немає закритих кроків без третьої зірки.</p> : (
            <ul className="confirm-list">
              {pending.slice(0, 8).map((level) => (
                <li key={level.id}>
                  <span>{level.title}</span>
                  <button type="button" className="btn tiny" onClick={() => act((prev) => confirmStar(prev, content, rewards, { personId: snap.person.id, levelId: level.id, by: 'керівник' }))}>Підтвердити</button>
                </li>
              ))}
            </ul>
          )}
          <h3>Подарунок від buddy</h3>
          <div className="row-btns">
            {rewards.boosters.map((item) => (
              <button key={item.id} type="button" className="btn tiny" onClick={() => act((prev) => giveBooster(prev, content, { personId: snap.person.id, boosterId: item.id }))}>
                Дати «{item.name}»
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="card">
        <h2>Заявки на нагороди</h2>
        {state.requests.length === 0 ? <p className="quiet">Поки ніхто не просив набір чи мерч.</p> : (
          <ul className="confirm-list">
            {state.requests.map((request) => {
              const item = rewards.rewards.find((reward) => reward.id === request.rewardId);
              return (
                <li key={request.id}>
                  <span>{item?.name || request.rewardId} · {request.status === 'done' ? 'передано' : 'нова'}</span>
                  {request.status !== 'done' && (
                    <button type="button" className="btn tiny" onClick={() => act((prev) => ({ ok: true, state: { ...prev, requests: prev.requests.map((row) => row.id === request.id ? { ...row, status: 'done' } : row) } }))}>Позначити переданою</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Файли для HR</h2>
        <p>Джерело правди — JSON у репозиторії. Завантаження нижче змінює лише цей браузер.</p>
        <div className="row-btns">
          <button type="button" className="btn tiny" onClick={() => downloadBlob('content.json', JSON.stringify(content, null, 2), 'application/json')}>Завантажити content.json</button>
          <button type="button" className="btn tiny" onClick={() => downloadBlob('rewards.json', JSON.stringify(rewards, null, 2), 'application/json')}>Завантажити rewards.json</button>
          <label className="btn tiny ghost">Замінити контент<input type="file" accept="application/json" hidden onChange={(event) => readFile(event, 'content')} /></label>
          <label className="btn tiny ghost">Замінити економіку<input type="file" accept="application/json" hidden onChange={(event) => readFile(event, 'rewards')} /></label>
        </div>
        {note && <p role="status">{note}</p>}
      </section>
    </div>
  );
}

function PulseChart({ snapshots }) {
  const waves = [
    ['30', '30 днів'],
    ['90', '90 днів'],
    ['365', '365 днів'],
  ];
  return (
    <section className="card">
      <h2>Пульс когорти</h2>
      <p className="quiet">Середнє за осями. Люди не бачать чужі відповіді на мапі.</p>
      <div className="chart-wrap">
        <svg viewBox="0 0 640 220" role="img" aria-label="Середні оцінки пульсу на 30, 90 і 365 день">
          {waves.map(([wave, label], index) => {
            const averages = pulseAverages(
              snapshots.map((snap) => snap.person),
              Object.fromEntries(snapshots.map((snap) => [snap.person.id, snap.pulse])),
              wave,
            );
            const origin = 70 + index * 200;
            return (
              <g key={wave}>
                <text x={origin + 36} y="208" textAnchor="middle" fill="#3A2418" fontSize="14">{label}</text>
                {averages.map((axis, axisIndex) => {
                  const height = axis.avg == null ? 0 : (axis.avg / 5) * 140;
                  const x = origin + axisIndex * 36;
                  return (
                    <g key={axis.axis}>
                      <rect x={x} y={180 - height} width="26" height={height} rx="6" fill={AXIS_COLOR[axis.axis]} />
                      <text x={x + 13} y={172 - height} textAnchor="middle" fill="#3A2418" fontSize="12">
                        {axis.avg == null ? '—' : axis.avg.toFixed(1)}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <ul className="legend">
          {PULSE_AXES.map((axis) => <li key={axis.id}><i style={{ background: AXIS_COLOR[axis.id] }} />{axis.label}</li>)}
        </ul>
      </div>
    </section>
  );
}
