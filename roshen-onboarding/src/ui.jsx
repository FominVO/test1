import { useEffect, useRef, useState } from 'react';
import { useGame } from './store.jsx';
import { ROSHEN_LOGO_PATH } from './roshenLogoPath.js';

export function RoshenLogo({ className = 'brand-logo' }) {
  return (
    <svg className={className} viewBox="0 0 169.8 40" role="img" aria-label="Roshen">
      <path fill="currentColor" d={ROSHEN_LOGO_PATH} />
    </svg>
  );
}

export const C4 = {
  compliance: 'Відповідність',
  clarification: 'Прояснення',
  culture: 'Культура',
  connection: 'Звʼязок',
};

export function candyLabel(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} цукерка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} цукерки`;
  return `${count} цукерок`;
}

export function initials(name) {
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function assetSrc(manifest, key) {
  if (!manifest || !key) return null;
  let node = manifest;
  for (const part of key.split('.')) node = node?.[part];
  if (typeof node !== 'string' || !node) return null;
  return `${import.meta.env.BASE_URL}${node}`;
}

export function Art({ id, alt = '', className = '' }) {
  const { manifest } = useGame();
  const src = assetSrc(manifest, id);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <SvgFallback id={id} className={className} label={alt} />;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}

export function Stars({ value = 0, max = 3, burst = false }) {
  return (
    <span className={`stars ${burst ? 'burst' : ''}`} aria-label={`${value} з ${max} зірок`}>
      {Array.from({ length: max }, (_, index) => (
        <svg key={index} viewBox="0 0 20 20" className={index < value ? 'on' : 'off'} aria-hidden="true">
          <path d="M10 1.8 12.4 7l5.6.5-4.2 3.6 1.3 5.4L10 13.8 4.9 16.5 6.2 11 2 7.5 7.6 7z" />
        </svg>
      ))}
    </span>
  );
}

export function Dialog({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const previous = document.activeElement;
    const focusable = () => [...root.querySelectorAll('button, [href], input, select, textarea')].filter((el) => !el.disabled);
    focusable()[0]?.focus();
    function onKey(event) {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const list = focusable();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
      <div className={`dialog ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title" ref={ref}>
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Закрити">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confetti({ show }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  if (!show || reduced) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, index) => (
        <i key={index} style={{ '--x': `${(index * 37) % 100}%`, '--r': `${(index * 47) % 360}deg`, '--d': `${0.2 + (index % 6) * 0.08}s`, '--c': ['#E39B3A', '#C73B62', '#1F9D78', '#FFF6E8', '#6B3E26'][index % 5] }} />
      ))}
    </div>
  );
}

export function downloadBlob(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function SvgFallback({ id, className, label }) {
  const kind = id?.includes('badge') ? 'badge' : id?.includes('icon') || id?.startsWith('icons') ? 'icon' : id;
  return (
    <svg className={`svg-fallback ${className}`} viewBox="0 0 64 64" role="img" aria-label={label || 'Ілюстрація'}>
      {kind === 'mascot' && (
        <>
          <circle cx="32" cy="32" r="28" fill="#6B3E26" />
          <circle cx="32" cy="30" r="16" fill="#C9895A" />
          <circle cx="26" cy="28" r="2" fill="#2A1A12" />
          <circle cx="38" cy="28" r="2" fill="#2A1A12" />
          <path d="M26 36c4 4 8 4 12 0" stroke="#2A1A12" strokeWidth="2" fill="none" />
        </>
      )}
      {kind === 'badge' && (
        <>
          <circle cx="32" cy="28" r="16" fill="#E39B3A" />
          <path d="M24 42 32 36 40 42 38 54 32 50 26 54z" fill="#C73B62" />
        </>
      )}
      {kind !== 'mascot' && kind !== 'badge' && (
        <>
          <rect width="64" height="64" rx="16" fill="#F6E6D0" />
          <circle cx="32" cy="32" r="14" fill="#E39B3A" />
          <circle cx="32" cy="32" r="6" fill="#FFF8EE" />
        </>
      )}
    </svg>
  );
}
