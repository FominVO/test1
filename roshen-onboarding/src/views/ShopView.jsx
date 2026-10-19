import { buyItem } from '../logic.js';
import { candyLabel } from '../ui.jsx';

export function ShopView({ state, rewards, act, asOf }) {
  return (
    <div className="stack-page">
      <section className="card">
        <p className="eyebrow">Гаманець</p>
        <h2>{candyLabel(state.candies)}</h2>
        <p>Цукерки дають за кроки, зірки, серію днів і підтримку колег. Їх витрачають на бустери або на заявку в HR. Штрафів немає.</p>
        <ul className="pocket">
          {rewards.boosters.map((item) => <li key={item.id}>{item.name}: {state.boosters[item.id] || 0}</li>)}
        </ul>
      </section>
      <section className="card-grid">
        {rewards.boosters.map((item) => (
          <article key={item.id} className="card">
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <p className="quiet">Звідки береться: {item.sources.join(', ')}.</p>
            <button type="button" className="btn" disabled={state.candies < item.cost} onClick={() => act((prev) => buyItem(prev, rewards, { itemId: item.id, asOf }))}>
              {item.cost} цукерок
            </button>
          </article>
        ))}
        {rewards.rewards.map((item) => (
          <article key={item.id} className="card reward-card">
            <h3>{item.name}</h3>
            <p>{item.description}</p>
            <button type="button" className="btn" disabled={state.candies < item.cost} onClick={() => act((prev) => buyItem(prev, rewards, { itemId: item.id, asOf }))}>
              Заявка · {item.cost}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}
