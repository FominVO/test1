import { eventToIcs, formatWeekday } from '../logic.js';
import { Art, downloadBlob } from '../ui.jsx';

export function SidePanel({ model, onOpen, onDaily }) {
  const today = model.asOf;
  return (
    <aside className="side" aria-label="Календар і когорта">
      <section className="card daily-card">
        <Art id="mascot" alt="" className="mini-mascot" />
        <div>
          <h2>Щоденний дарунок</h2>
          <p>{model.dailyClaimed ? 'Сьогодні вже забрано. Завтра буде інше: квіз або знайомство.' : 'Короткий квіз про продукт або нове знайомство. Пропуск нічого не спалює.'}</p>
          <button type="button" className="btn tiny" onClick={onDaily} disabled={model.dailyClaimed}>
            {model.dailyClaimed ? 'Забрано' : 'Відкрити'}
          </button>
        </div>
      </section>
      <section className="card">
        <h2>Ціль когорти</h2>
        <p>{model.cohort.detail}</p>
        <div className="bar" role="meter" aria-valuemin={0} aria-valuemax={model.cohort.total} aria-valuenow={model.cohort.done} aria-label={model.cohort.title}>
          <span style={{ width: `${model.cohort.total ? (model.cohort.done / model.cohort.total) * 100 : 0}%` }} />
        </div>
        <p className="quiet">{model.cohort.done} з {model.cohort.total} уже пройшли квіз. Без рейтингу швидкості.</p>
      </section>
      <section className="card">
        <h2>Календар</h2>
        <ul className="agenda">
          {model.events.map((event) => {
            const past = event.date < today;
            const now = event.date === today;
            return (
              <li key={event.id} className={now ? 'is-today' : past ? 'is-past' : ''}>
                <Art id={`icons.${event.icon}`} alt="" className="agenda-icon" />
                <div>
                  <p className="quiet">{formatWeekday(event.date)} · {event.time}</p>
                  <p className="agenda-title">{event.title}</p>
                  <p className="quiet">{event.place}</p>
                  <div className="row-btns">
                    <button type="button" className="btn tiny" onClick={() => downloadBlob(`${event.id}.ics`, eventToIcs(event), 'text/calendar')}>Додати в календар</button>
                    {event.levelId && <button type="button" className="btn tiny ghost" onClick={() => onOpen(event.levelId)}>До кроку</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
