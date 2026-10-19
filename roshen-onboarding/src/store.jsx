import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { freshState } from './logic.js';

const KEY = 'roshen-onboarding-v1';
const CONTENT_KEY = 'roshen-onboarding-content';
const REWARDS_KEY = 'roshen-onboarding-rewards';
const GameContext = createContext(null);

function readOverride(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function loadJson(path, overrideKey) {
  const override = readOverride(overrideKey);
  if (override) return override;
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Не вдалося відкрити ${path}`);
  return response.json();
}

export function GameProvider({ children }) {
  const [content, setContent] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([
      loadJson(`${base}data/content.json`, CONTENT_KEY),
      loadJson(`${base}data/rewards.json`, REWARDS_KEY),
      fetch(`${base}assets/manifest.json`).then((response) => {
        if (!response.ok) throw new Error('manifest');
        return response.json();
      }),
    ]).then(([contentData, rewardsData, manifestData]) => {
      setContent(contentData);
      setRewards(rewardsData);
      setManifest(manifestData);
      let next = freshState(contentData, rewardsData);
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (saved?.v === 1 && saved.progress) next = { ...next, ...saved, toast: null };
      } catch {
        /* keep the fresh demo */
      }
      setState(next);
    }).catch((err) => setError(err.message || 'Помилка завантаження'));
  }, []);

  useEffect(() => {
    if (!state) return;
    const { toast, ...rest } = state;
    localStorage.setItem(KEY, JSON.stringify(rest));
  }, [state]);

  const api = useMemo(() => ({
    content,
    rewards,
    manifest,
    state,
    error,
    setState,
    saveContent(next) {
      localStorage.setItem(CONTENT_KEY, JSON.stringify(next));
      setContent(next);
    },
    saveRewards(next) {
      localStorage.setItem(REWARDS_KEY, JSON.stringify(next));
      setRewards(next);
    },
    reset() {
      localStorage.removeItem(KEY);
      localStorage.removeItem(CONTENT_KEY);
      localStorage.removeItem(REWARDS_KEY);
      window.location.reload();
    },
  }), [content, rewards, manifest, state, error]);

  return <GameContext.Provider value={api}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
