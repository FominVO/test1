import { useEffect, useState } from 'react';
import { Art, Stars, initials } from '../ui.jsx';
import { formatLong, helpPerson } from '../logic.js';
import { worldArtFor } from '../worldArt.js';

export function MapView({ model, onOpen, act, content, rewards }) {
  const [friendId, setFriendId] = useState(null);

  useEffect(() => {
    const node = document.getElementById('current-level');
    if (!node) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  return (
    <div className="map-screen">
      <div className="guide">
        <Art id="mascot" alt="Пралінка, гід адаптації" className="mascot" />
        <div>
          <p className="eyebrow">Пралінка</p>
          <p>{model.tip}</p>
        </div>
      </div>
      <div className="map-toolbar">
        <p>День {model.mine.dayNum} · {formatLong(model.asOf)}</p>
        <button type="button" className="btn tiny" onClick={() => document.getElementById('current-level')?.scrollIntoView({ block: 'center' })}>До мого кроку</button>
      </div>
      <div className="saga-column map-column">
        {model.worlds.map((world) => (
          <WorldBand key={world.id} world={world} worlds={model.worlds} friendId={friendId} setFriendId={setFriendId} onOpen={onOpen} act={act} content={content} rewards={rewards} />
        ))}
        {model.horizon && <Horizon level={model.horizon} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function WorldBand({ world, worlds, friendId, setFriendId, onOpen, act, content, rewards }) {
  const points = layout(world.levels);
  const prev = world.index > 0 ? worlds[world.index - 1] : null;
  const artUrl = worldArtFor(world.id);
  const roadId = `road-${world.id}`;
  const d = curveThrough(points);
  return (
    <section className={`world-band ${world.unlocked ? '' : 'is-locked'}`} data-world={world.id} style={{ '--zone': world.accent, '--stack': 8 - world.index }} aria-labelledby={`world-${world.id}`}>
      <img className="band-art" src={artUrl} alt="" />
      <header className="world-plaque">
        <p className="eyebrow">{world.kicker}</p>
        <h2 id={`world-${world.id}`}>{world.title}</h2>
        <p>{world.summary}</p>
        <p className="quiet">{world.earnedStars}/{world.maxStars} зірок · {world.unlocked ? 'відкрито' : `відкриється ${formatLong(world.unlockDate)}`}</p>
      </header>
      {!world.unlocked && prev && (
        <p className="gate">70% зірок «{prev.title}» ({prev.earnedStars}/{prev.maxStars}) або {formatLong(world.unlockDate)}. Хто не встиг зірками, все одно заходить у календарний день.</p>
      )}
      <div className="path-stage">
        <svg className="trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={roadId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6a3a16" />
              <stop offset="0.42" stopColor="#f0c27a" />
              <stop offset="0.55" stopColor="#fff1c9" />
              <stop offset="1" stopColor="#8a5418" />
            </linearGradient>
            <filter id={`${roadId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>
          <path className="road-glow" pathLength="100" d={d} filter={`url(#${roadId}-glow)`} />
          <path className="road-gold" pathLength="100" d={d} />
          <path className="road-body" pathLength="100" d={d} stroke={`url(#${roadId})`} />
          <path className="road-dots" pathLength="100" d={d} />
        </svg>
        {points.map((level) => (
          <LevelNode key={level.id} level={level} onOpen={onOpen} friendId={friendId} setFriendId={setFriendId} act={act} content={content} rewards={rewards} />
        ))}
      </div>
    </section>
  );
}

function Horizon({ level, onOpen }) {
  return (
    <section className="horizon">
      <img className="horizon-bg" src={worldArtFor('w5')} alt="" />
      <div>
        <p className="eyebrow">Горизонт</p>
        <h2>Рік у компанії</h2>
        <p>Пульс 365 днів за тими самими осями: інструменти, продуктивність, культура.</p>
        <button type="button" className="btn tiny" onClick={() => onOpen(level)}>{level.locked ? `Відкриється ${formatLong(level.unlockDate)}` : level.title}</button>
      </div>
    </section>
  );
}

function LevelNode({ level, onOpen, friendId, setFriendId, act, content, rewards }) {
  return (
    <div
      className="node-anchor"
      style={{ left: `${level.x}%`, top: `${level.y}%` }}
      data-x={level.x}
      data-y={level.y}
      id={level.current ? 'current-level' : undefined}
    >
      <button
        type="button"
        className={`node ${level.current ? 'is-current' : ''} ${level.completed ? 'is-done' : ''} ${level.locked ? 'is-locked' : ''} ${level.overdue ? 'is-overdue' : ''}`}
        onClick={() => onOpen(level)}
        aria-current={level.current ? 'step' : undefined}
        aria-label={`${level.title}. ${level.stars} з 3 зірок. ${level.locked ? 'Ще зачинено' : level.completed ? 'Закрито' : 'Відкрито'}`}
      >
        <Art id={`icons.${level.icon}`} alt="" />
      </button>
      <Stars value={level.stars} />
      <span className={`node-label ${level.labelSide}`} style={level.labelDy ? { transform: `translateY(calc(-50% + ${level.labelDy}px))` } : undefined}>{level.title}</span>
      {level.friends?.length > 0 && (
        <div className="friend-stack">
          {level.friends.map((person) => (
            <span key={person.id} className="friend-slot">
              <button
                type="button"
                className="friend"
                style={{ background: person.avatar }}
                aria-expanded={friendId === person.id}
                aria-label={`${person.name}, ${person.role}. Зараз на цьому кроці`}
                onClick={() => setFriendId(friendId === person.id ? null : person.id)}
              >
                {initials(person.name)}
              </button>
              {friendId === person.id && (
                <span className="popover" role="dialog" aria-label={person.name}>
                  <strong>{person.name}</strong>
                  <span>{person.role}</span>
                  <span>{person.site}</span>
                  <button
                    type="button"
                    className="btn tiny"
                    onClick={() => act((prev) => helpPerson(prev, content, rewards, { personId: person.id }))}
                  >
                    Підтримати
                  </button>
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function layout(levels) {
  const count = levels.length;
  const points = levels.map((level, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return {
      ...level,
      y: 92 - t * 84,
      x: 50 + Math.sin(t * Math.PI * 2 + 0.35) * 6,
    };
  });
  const placed = [];
  return points.map((level) => {
    let side = level.x < 50 ? 'is-left' : 'is-right';
    const clash = (candidate) => placed.some((item) => item.side === candidate && Math.abs(item.y - level.y) < 11);
    if (clash(side)) side = side === 'is-left' ? 'is-right' : 'is-left';
    const labelDy = clash(side) ? 28 : 0;
    placed.push({ side, y: level.y + labelDy / 8 });
    return { ...level, labelSide: side, labelDy };
  });
}

function curveThrough(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}
