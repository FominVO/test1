import { formatLong, helpPerson } from '../logic.js';
import { Art, candyLabel, initials } from '../ui.jsx';

export function ProfileView({ model, state, rewards, content, act }) {
  const { me, mine, streak, rank, badges, buddy, manager } = model;
  const nextGap = rank.next ? Math.max(1, rank.next.xp - rank.current.xp) : 1;
  const into = rank.next ? Math.min(100, ((state.xp - rank.current.xp) / nextGap) * 100) : 100;
  const friends = [...model.snapshots].filter((snap) => snap.person.id !== me.id).sort((a, b) => a.person.name.localeCompare(b.person.name, 'uk'));

  function addAbsence(kind, date) {
    if (!date) return;
    act((prev) => {
      const list = prev.absences[kind] || [];
      if (list.includes(date)) return { ok: true, state: prev };
      return { ok: true, state: { ...prev, absences: { ...prev.absences, [kind]: [...list, date].sort() } } };
    });
  }

  return (
    <div className="stack-page">
      <section className="card hero-card">
        <div className="avatar" style={{ background: me.avatar }} aria-hidden="true">{initials(me.name)}</div>
        <div>
          <p className="eyebrow">{me.department} · {me.site}</p>
          <h2>{me.name}</h2>
          <p>{me.role} · старт {formatLong(me.startDate)} · день {mine.dayNum}</p>
          <p className="rank">{rank.current.name}</p>
          <div className="bar" role="meter" aria-label="Досвід до наступної назви" aria-valuenow={Math.round(into)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${into}%` }} />
          </div>
          <p className="quiet">{rank.next ? `${state.xp} XP · далі «${rank.next.name}» з ${rank.next.xp}` : `${state.xp} XP`}</p>
        </div>
      </section>
      <section className="stat-grid">
        <article className="card"><p className="eyebrow">Прогрес</p><strong>{model.percent}%</strong></article>
        <article className="card"><p className="eyebrow">Зірки</p><strong>{mine.stars}<span>/{mine.starsMax}</span></strong></article>
        <article className="card"><p className="eyebrow">Цукерки</p><strong>{candyLabel(state.candies)}</strong></article>
        <article className="card"><p className="eyebrow">Серія</p><strong>{streak.count} дн.</strong><p className="quiet">{streak.paused ? 'На паузі, не згоріла' : 'Тримається'}</p></article>
      </section>
      <section className="card">
        <h2>Серія не згорає</h2>
        <p>Вихідні, лікарняний і відпустка — заморозка. Якщо пропустити звичайний день, лічильник стає на паузу і продовжується з того самого числа.</p>
        {streak.gap.length > 0 && <p className="quiet">Зараз у проміжку: {streak.gap.map((item) => `${formatLong(item.date)} (${item.reason})`).join(', ')}.</p>}
        <div className="split">
          <AbsenceForm label="Лікарняний" kind="sick" dates={state.absences.sick} onAdd={addAbsence} />
          <AbsenceForm label="Відпустка" kind="vacation" dates={state.absences.vacation} onAdd={addAbsence} />
        </div>
      </section>
      <section className="card">
        <h2>Зустрічі з buddy</h2>
        <p className="quiet">{mine.buddies.done} з {mine.buddies.total} щотижневих уже відбулись. Чим більше розмов за перші 90 днів, тим спокійніше входить людина в контекст.</p>
        <div className="people-row">
          <PersonCard title="Buddy" person={buddy} />
          <PersonCard title="Керівник" person={manager} />
        </div>
      </section>
      <section className="card">
        <h2>Відзнаки за події</h2>
        <ul className="badge-grid">
          {badges.map((badge) => (
            <li key={badge.id} className={badge.earned ? 'is-earned' : ''}>
              <Art id={badge.asset} alt="" className="badge-art" />
              <strong>{badge.name}</strong>
              <span>{badge.detail}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Поруч у когорті</h2>
        <p className="quiet">Імена і ролі, без сортування за швидкістю.</p>
        <ul className="cohort-list">
          {friends.map((snap) => {
            const helped = state.helped.includes(snap.person.id);
            return (
              <li key={snap.person.id}>
                <span className="avatar sm" style={{ background: snap.person.avatar }}>{initials(snap.person.name)}</span>
                <span><b>{snap.person.name}</b><br /><span className="quiet">{snap.person.role} · {snap.person.site}</span></span>
                <button type="button" className="btn tiny" disabled={helped} onClick={() => act((prev) => helpPerson(prev, content, rewards, { personId: snap.person.id }))}>
                  {helped ? 'Вже поруч' : 'Підтримати'}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function PersonCard({ title, person }) {
  if (!person) return null;
  return (
    <article className="person-card">
      <p className="eyebrow">{title}</p>
      <h3>{person.name}</h3>
      <p>{person.role}</p>
      <p className="quiet">{person.site}</p>
    </article>
  );
}

function AbsenceForm({ label, kind, dates, onAdd }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onAdd(kind, event.currentTarget.elements.date.value); event.currentTarget.reset(); }}>
      <label>{label}
        <input name="date" type="date" required />
      </label>
      <button type="submit" className="btn tiny">Додати заморозку</button>
      <p className="quiet">{dates?.length ? dates.map((date) => formatLong(date)).join(', ') : 'Поки порожньо'}</p>
    </form>
  );
}
