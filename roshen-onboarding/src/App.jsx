import { useEffect, useMemo, useState } from 'react';
import { assemble, claimDaily, dailyOffer, formatLong } from './logic.js';
import { useGame } from './store.jsx';
import { Art, Confetti, Dialog, Stars, candyLabel } from './ui.jsx';
import { HrView } from './views/HrView.jsx';
import { LevelSheet } from './views/LevelSheet.jsx';
import { MapView } from './views/MapView.jsx';
import { ProfileView } from './views/ProfileView.jsx';
import { ShopView } from './views/ShopView.jsx';
import { SidePanel } from './views/SidePanel.jsx';

const TABS = [
  ['map', 'Мапа'],
  ['calendar', 'Дні'],
  ['profile', 'Профіль'],
  ['shop', 'Цукерки'],
  ['hr', 'HR'],
];

function useRoute() {
  const read = () => {
    const parts = (window.location.hash || '#/map').replace(/^#\/?/, '').split('/');
    if (parts[0] === 'level') return { view: 'map', levelId: parts[1] || null };
    const view = TABS.some(([id]) => id === parts[0]) ? parts[0] : 'map';
    return { view, levelId: null };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.location.hash = '#/map';
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  function go(view, levelId) {
    window.location.hash = levelId ? `#/level/${levelId}` : `#/${view}`;
  }
  return { ...route, go };
}

export function App() {
  const game = useGame();
  const route = useRoute();
  const [dailyOpen, setDailyOpen] = useState(false);
  const model = useMemo(
    () => (game.content && game.rewards && game.state ? assemble(game.content, game.rewards, game.state) : null),
    [game.content, game.rewards, game.state],
  );

  function act(mutator) {
    let result = { ok: false, error: 'Ще не готово', state: game.state };
    game.setState((prev) => {
      result = mutator(prev);
      return result.state;
    });
    return result;
  }

  if (game.error) {
    return <main className="boot"><p>Не вдалося відкрити дані: {game.error}</p></main>;
  }
  if (!model) return <main className="boot"><p>Збираємо мапу адаптації…</p></main>;

  const level = findLevel(model, route.levelId);
  const toast = game.state.toast;

  return (
    <>
      <a className="skip" href="#main">До змісту</a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <div>
            <p className="eyebrow">Портал адаптації</p>
            <h1 className="wordmark">Roshen</h1>
          </div>
        </div>
        <div className="stats" aria-label="Поточний рахунок">
          <span>{candyLabel(game.state.candies)}</span>
          <span>Серія {model.streak.count}</span>
          <span>{model.mine.stars} зірок</span>
          <span>{model.percent}%</span>
        </div>
        <p className="today">{formatLong(model.asOf)}</p>
      </header>
      <div className="subnav" role="tablist" aria-label="Розділи">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={route.view === id} className={route.view === id ? 'is-on' : ''} onClick={() => route.go(id)}>
            {label}
          </button>
        ))}
      </div>
      <main id="main" className={`workspace view-${route.view}`}>
        {route.view === 'map' && (
          <>
            <MapView model={model} content={game.content} rewards={game.rewards} act={act} onOpen={(item) => route.go('map', item.id)} />
            <SidePanel model={model} onDaily={() => setDailyOpen(true)} onOpen={(id) => route.go('map', id)} />
          </>
        )}
        {route.view === 'calendar' && <SidePanel model={model} onDaily={() => setDailyOpen(true)} onOpen={(id) => route.go('map', id)} />}
        {route.view === 'profile' && <ProfileView model={model} state={game.state} rewards={game.rewards} content={game.content} act={act} />}
        {route.view === 'shop' && <ShopView state={game.state} rewards={game.rewards} act={act} asOf={model.asOf} />}
        {route.view === 'hr' && (
          <HrView model={model} content={game.content} rewards={game.rewards} state={game.state} act={act} saveContent={game.saveContent} saveRewards={game.saveRewards} />
        )}
      </main>
      <nav className="tabbar" aria-label="Розділи">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={route.view === id ? 'is-on' : ''} onClick={() => route.go(id)}>{label}</button>
        ))}
      </nav>
      <p className="reset-row">
        <button type="button" className="text-btn" onClick={game.reset}>Скинути демо в цьому браузері</button>
      </p>
      <div className="sr-live" aria-live="polite">{toast?.title} {toast?.text || ''}</div>
      {level && (
        <LevelSheet
          level={level}
          content={game.content}
          rewards={game.rewards}
          state={game.state}
          act={act}
          onClose={() => route.go('map')}
        />
      )}
      {dailyOpen && <DailyDialog content={game.content} state={game.state} rewards={game.rewards} act={act} onClose={() => setDailyOpen(false)} />}
      {toast?.kind === 'level' && (
        <Dialog title="Крок закрито" onClose={() => act((prev) => ({ ok: true, state: { ...prev, toast: null } }))}>
          <Confetti show />
          <Art id="levelComplete" alt="" className="celebrate-art" />
          <p>{toast.title}</p>
          <Stars value={toast.stars} burst />
          <p>+{toast.candies} цукерок · +{toast.xp} XP</p>
          {toast.badges?.length > 0 && <p>Нова відзнака: {toast.badges.map((badge) => badge.name).join(', ')}</p>}
        </Dialog>
      )}
      {toast && toast.kind !== 'level' && (
        <button type="button" className="toast" onClick={() => act((prev) => ({ ok: true, state: { ...prev, toast: null } }))}>
          <strong>{toast.title}</strong>
          <span>{toast.text}</span>
        </button>
      )}
    </>
  );
}

function findLevel(model, id) {
  if (!id) return null;
  for (const world of model.worlds) {
    const found = world.levels.find((level) => level.id === id);
    if (found) return found;
  }
  if (model.horizon?.id === id) return model.horizon;
  return null;
}

function DailyDialog({ content, state, rewards, act, onClose }) {
  const asOf = state.asOfOverride || content.meta.asOf;
  const offer = dailyOffer(content, asOf, state.met);
  const [choice, setChoice] = useState(null);
  const [done, setDone] = useState(false);
  const claimed = state.daily?.date === asOf;

  function take(correct) {
    const result = act((prev) => claimDaily(prev, content, rewards, { correct }));
    if (result.ok) setDone(true);
  }

  return (
    <Dialog title="Щоденний дарунок" onClose={onClose}>
      {claimed || done ? <p>На сьогодні все. Завтра буде інший маленький дарунок, і серія від пропуску не згорить.</p> : null}
      {!claimed && !done && offer.kind === 'quiz' && (
        <fieldset>
          <legend>{offer.quiz.q}</legend>
          {offer.quiz.choices.map((choiceText, index) => (
            <label key={choiceText}>
              <input type="radio" name="daily" checked={choice === index} onChange={() => setChoice(index)} />
              {choiceText}
            </label>
          ))}
          <button type="button" className="btn" disabled={choice == null} onClick={() => take(choice === offer.quiz.answer)}>Забрати цукерки</button>
          <p className="quiet">Навіть якщо відповідь мимо, дарунок лишається. Правильна відповідь додає трохи більше.</p>
        </fieldset>
      )}
      {!claimed && !done && offer.kind === 'acquaintance' && (
        <div>
          <p className="eyebrow">Нове знайомство</p>
          <h3>{offer.person.name}</h3>
          <p>{offer.person.role} · {offer.person.site}</p>
          <p>{offer.person.prompt}</p>
          <button type="button" className="btn" onClick={() => take(false)}>Познайомитись і забрати цукерки</button>
        </div>
      )}
    </Dialog>
  );
}
