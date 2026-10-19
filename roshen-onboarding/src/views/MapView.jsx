import { useEffect, useState } from 'react';
import { Art, Stars, assetSrc, initials } from '../ui.jsx';
import { useGame } from '../store.jsx';
import { formatLong, helpPerson } from '../logic.js';

export function MapView({ model, onOpen, act, content, rewards }) {
  const { manifest } = useGame();
  const mapUrl = assetSrc(manifest, 'mapBackground');
  const [mapOk, setMapOk] = useState(Boolean(mapUrl));
  const [friendId, setFriendId] = useState(null);

  useEffect(() => {
    if (!mapUrl) return;
    const image = new Image();
    image.onload = () => setMapOk(true);
    image.onerror = () => setMapOk(false);
    image.src = mapUrl;
  }, [mapUrl]);

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
      <div className="map-column">
        {model.worlds.map((world) => (
          <WorldBand key={world.id} world={world} worlds={model.worlds} mapOk={mapOk} mapUrl={mapUrl} friendId={friendId} setFriendId={setFriendId} onOpen={onOpen} act={act} content={content} rewards={rewards} />
        ))}
        {model.horizon && <Horizon level={model.horizon} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function WorldBand({ world, worlds, mapOk, mapUrl, friendId, setFriendId, onOpen, act, content, rewards }) {
  const points = layout(world.levels);
  const fromTop = (worlds.length - 1 - world.index) / (worlds.length - 1);
  const prev = world.index > 0 ? worlds[world.index - 1] : null;
  const style = mapOk && mapUrl ? {
    '--zone': world.accent,
    backgroundImage: `linear-gradient(180deg, rgba(255,248,238,.72), rgba(255,248,238,.18) 16%, rgba(255,248,238,.12) 70%, rgba(42,26,18,.22)), url(${mapUrl})`,
    backgroundSize: '100% 100%, 100% 600%',
    backgroundPosition: `center center, center ${fromTop * 100}%`,
    backgroundRepeat: 'no-repeat',
  } : { '--zone': world.accent, background: `linear-gradient(180deg, #fff8ee, ${world.accent})` };
  const d = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  return (
    <section className={`world-band ${world.unlocked ? '' : 'is-locked'}`} style={style} aria-labelledby={`world-${world.id}`}>
      <header className="world-plaque">
        <p className="eyebrow">{world.kicker}</p>
        <h2 id={`world-${world.id}`}>{world.title}</h2>
        <p>{world.summary}</p>
        <p className="quiet">{world.earnedStars}/{world.maxStars} зірок · {world.unlocked ? 'відкрито' : `відкриється ${formatLong(world.unlockDate)}`}</p>
      </header>
      {!world.unlocked && prev && (
        <p className="gate">70% зірок «{prev.title}» ({prev.earnedStars}/{prev.maxStars}) або {formatLong(world.unlockDate)}. Хто не встиг зірками, все одно заходить у календарний день.</p>
      )}
      <svg className="trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="road" d={d} />
        <path className="road-core" d={d} />
      </svg>
      {points.map((level) => (
        <LevelNode key={level.id} level={level} onOpen={onOpen} friendId={friendId} setFriendId={setFriendId} act={act} content={content} rewards={rewards} />
      ))}
    </section>
  );
}

function Horizon({ level, onOpen }) {
  return (
    <section className="horizon">
      <Art id="worldBackground" alt="" className="horizon-bg" />
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
  const labelSide = level.x > 54 ? 'is-left' : 'is-right';
  return (
    <div className="node-wrap" style={{ left: `${level.x}%`, top: `${level.y}%` }} id={level.current ? 'current-level' : undefined}>
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
      <span className={`node-label ${labelSide}`}>{level.title}</span>
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
  return levels.map((level, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return {
      ...level,
      y: 80 - t * 54,
      x: 46 + Math.sin(t * Math.PI * 2.15 + 0.4) * 24,
    };
  });
}
