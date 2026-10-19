import { useEffect, useRef, useState } from 'react';
import { createBoard, findMatches, resolveBoard } from '../logic.js';

const COLS = 7;
const NAMES = {
  praline: 'праліне',
  caramel: 'карамель',
  berry: 'ягода',
  mint: 'мʼята',
  wafer: 'вафля',
};

export function Match3({ target, moves, onWin }) {
  const [board, setBoard] = useState(() => createBoard(COLS, COLS));
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(moves);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(0);
  const [status, setStatus] = useState('Обери цукерку, потім сусідню.');
  const won = useRef(false);

  useEffect(() => {
    if (score >= target && !won.current) {
      won.current = true;
      setStatus('Лінію зібрано. Можна закривати бонус.');
      onWin(Math.min(1, score / target));
    }
  }, [score, target, onWin]);

  function reset() {
    won.current = false;
    setBoard(createBoard(COLS, COLS));
    setScore(0);
    setLeft(moves);
    setSelected(null);
    setStatus('Нова спроба. Прогрес адаптації на місці.');
  }

  function indexOf(x, y) {
    return y * COLS + x;
  }

  function trySwap(a, b) {
    const ax = a % COLS;
    const ay = Math.floor(a / COLS);
    const bx = b % COLS;
    const by = Math.floor(b / COLS);
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) {
      setSelected(b);
      return;
    }
    if (left <= 0 || won.current) return;
    const next = board.map((row) => row.slice());
    [next[ay][ax], next[by][bx]] = [next[by][bx], next[ay][ax]];
    if (!findMatches(next).count) {
      setStatus('Ці дві не збирають трійку. Спробуй іншу пару.');
      setSelected(null);
      return;
    }
    const resolved = resolveBoard(next);
    setBoard(resolved.board);
    setScore((value) => value + resolved.score);
    setLeft((value) => value - 1);
    setSelected(null);
    setStatus(resolved.score ? `+${resolved.score} за лінію` : 'Лінія зібрана');
  }

  function choose(index) {
    if (selected == null) setSelected(index);
    else trySwap(selected, index);
  }

  function onKey(event) {
    const max = COLS * COLS - 1;
    if (event.key === 'ArrowRight') setFocus((value) => Math.min(max, value + (value % COLS === COLS - 1 ? 0 : 1)));
    if (event.key === 'ArrowLeft') setFocus((value) => Math.max(0, value - (value % COLS === 0 ? 0 : 1)));
    if (event.key === 'ArrowDown') setFocus((value) => Math.min(max, value + COLS));
    if (event.key === 'ArrowUp') setFocus((value) => Math.max(0, value - COLS));
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(focus);
    }
  }

  const finishedFail = left <= 0 && score < target && !won.current;

  return (
    <div className="match">
      <div className="match-bar">
        <span>Ціль {target}</span>
        <strong>{score}</strong>
        <span>Ходів {left}</span>
      </div>
      <div className="match-grid" role="grid" aria-label="Солодка лінія, три в ряд" onKeyDown={onKey}>
        {board.flatMap((row, y) => row.map((type, x) => {
          const index = indexOf(x, y);
          return (
            <button
              key={index}
              type="button"
              role="gridcell"
              className={`candy candy-${type} ${selected === index ? 'is-selected' : ''}`}
              aria-label={NAMES[type]}
              tabIndex={focus === index ? 0 : -1}
              onFocus={() => setFocus(index)}
              onClick={() => { setFocus(index); choose(index); }}
            />
          );
        }))}
      </div>
      <p className="quiet">{status}</p>
      {finishedFail && <button type="button" className="btn secondary" onClick={reset}>Ще спроба</button>}
      <p className="quiet">Керування: стрілки і Enter. Немає життів — невдала спроба нічого не забирає.</p>
    </div>
  );
}
