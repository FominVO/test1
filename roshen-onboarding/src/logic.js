/** Pure rules for the onboarding map. No DOM, no penalties, no lost progress. */

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  const date = parseISO(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatISO(date);
}

export function dayNumber(startISO, asOfISO) {
  const ms = parseISO(asOfISO) - parseISO(startISO);
  return Math.round(ms / 86400000) + 1;
}

export function dateForDay(startISO, dayNum) {
  return addDays(startISO, dayNum - 1);
}

export function formatLong(iso) {
  return new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parseISO(iso));
}

export function formatWeekday(iso) {
  return new Intl.DateTimeFormat('uk-UA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parseISO(iso));
}

export function isWeekend(iso) {
  const day = parseISO(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function freezeReason(iso, absences, rules) {
  const streak = rules?.streak || {};
  if (streak.sickLeaveFreezes !== false && absences?.sick?.includes(iso)) return 'лікарняний';
  if (streak.vacationFreezes !== false && absences?.vacation?.includes(iso)) return 'відпустка';
  if (streak.weekendFreezes !== false && isWeekend(iso)) return 'вихідний';
  return null;
}

export function computeStars(entry, rewards) {
  if (!entry?.completed) return 0;
  const rules = rewards.stars;
  let stars = 0;
  if (entry.onTime) stars = 1;
  const quizOk = typeof entry.quizScore === 'number' && entry.quizScore >= rules.quizThreshold;
  if (entry.noReminders || quizOk) stars = Math.max(stars, 2);
  const reflection = (entry.reflection || '').trim();
  if (entry.confirmed || reflection.length >= rules.reflectionMinChars) stars = 3;
  return stars;
}

export function programLevels(levels) {
  return levels.filter((level) => !level.bonus && level.worldId !== 'horizon');
}

export function isWorldUnlocked(world, worldIndex, worlds, levels, progress, dayNum, rewards) {
  if (worldIndex <= 0) return true;
  if (rewards.worldGate.calendarUnlockAlways && dayNum >= world.unlockDay) return true;
  const prev = worlds[worldIndex - 1];
  const prevLevels = levels.filter((level) => level.worldId === prev.id && !level.bonus);
  const max = prevLevels.length * 3;
  if (!max) return true;
  const earned = prevLevels.reduce((sum, level) => sum + computeStars(progress[level.id], rewards), 0);
  return earned / max >= rewards.worldGate.starRatio;
}

export function isOverdue(level, entry, dayNum, unlocked) {
  if (!unlocked || level.bonus || entry?.completed) return false;
  if (typeof level.dueDay !== 'number') return false;
  return dayNum > level.dueDay;
}

export function expandStars(starsMap = {}) {
  const progress = {};
  for (const [id, stars] of Object.entries(starsMap)) {
    progress[id] = {
      completed: true,
      onTime: stars >= 1,
      noReminders: stars >= 2,
      quizScore: stars >= 2 ? 0.9 : null,
      reflection: stars >= 3 ? 'Якість підтверджено в демо-даних команди.' : '',
      confirmed: false,
      completedAt: null,
      checks: {},
      chapters: {},
      reveals: {},
    };
  }
  return progress;
}

export function starsFromSeed(seed, levels) {
  const done = seed?.done === '*'
    ? levels.filter((level) => !level.bonus).map((level) => level.id)
    : [...(seed?.done || [])];
  const map = {};
  for (const id of done) map[id] = 2;
  for (const id of seed?.ones || []) map[id] = 1;
  for (const id of seed?.threes || []) map[id] = 3;
  return map;
}

export function progressFromSeed(person, levels) {
  const map = starsFromSeed(person.seed, levels);
  const progress = expandStars(map);
  for (const [id, score] of Object.entries(person.seed?.quiz || {})) {
    if (progress[id]) progress[id].quizScore = score;
  }
  for (const [id, text] of Object.entries(person.seed?.reflections || {})) {
    if (progress[id]) progress[id].reflection = text;
  }
  return progress;
}

export function mergeProgress(base, override = {}) {
  const next = { ...base };
  for (const [id, patch] of Object.entries(override)) {
    next[id] = { ...(base[id] || {}), ...patch };
  }
  return next;
}

export function payout(prevStars, nextStars, rewards, first) {
  const starDelta = Math.max(0, nextStars - prevStars);
  return {
    xp: (first ? rewards.xp.perLevel : 0) + starDelta * rewards.xp.perStar,
    candies: (first ? rewards.candies.perLevel : 0) + starDelta * rewards.candies.perStar,
  };
}

export function streakView(streak, absences, today, rewards) {
  const count = streak?.count || 0;
  const last = streak?.lastActive || null;
  const frozenToday = Boolean(freezeReason(today, absences, rewards));
  if (!last || last >= today) {
    return { count, paused: false, frozenToday, lastActive: last, gap: [] };
  }
  const gap = [];
  let paused = false;
  let cursor = addDays(last, 1);
  while (cursor < today) {
    const reason = freezeReason(cursor, absences, rewards);
    if (reason) gap.push({ date: cursor, reason });
    else paused = true;
    cursor = addDays(cursor, 1);
  }
  return { count, paused, frozenToday, lastActive: last, gap };
}

export function touchStreak(streak, absences, today, rewards) {
  if (streak?.lastActive === today) return streak || { count: 0, lastActive: today };
  const current = streak?.count || 0;
  if (rewards?.streak?.neverBurns === false) {
    const view = streakView(streak || { count: 0, lastActive: null }, absences, today, rewards);
    return { count: view.paused ? 1 : current + 1, lastActive: today };
  }
  return { count: current + 1, lastActive: today };
}

export function buddyStats(levels, progress) {
  const meetings = levels.filter((level) => level.buddyWeekly);
  const done = meetings.filter((level) => progress[level.id]?.completed).length;
  return { done, total: meetings.length };
}

export function currentLevelId(person, content, rewards, progress, asOf) {
  const dayNum = dayNumber(person.startDate, asOf);
  const sequence = [];
  content.worlds.forEach((world, index) => {
    if (!isWorldUnlocked(world, index, content.worlds, content.levels, progress, dayNum, rewards)) return;
    for (const level of content.levels) {
      if (level.worldId === world.id && !level.bonus) sequence.push(level);
    }
  });
  const horizon = content.levels.find((level) => level.worldId === 'horizon');
  if (horizon && dayNum >= (horizon.unlockDay ?? 365)) sequence.push(horizon);
  const next = sequence.find((level) => !progress[level.id]?.completed);
  if (next) return next.id;
  return sequence.at(-1)?.id || null;
}

export function calendarEvents(person, content) {
  const events = [];
  for (const level of content.levels) {
    const scheduled = level.meeting || level.type === 'meeting' || level.type === 'pulse';
    if (!scheduled || typeof level.dueDay !== 'number') continue;
    events.push({
      id: `${person.id}-${level.id}`,
      levelId: level.id,
      title: level.title,
      date: dateForDay(person.startDate, level.dueDay),
      time: level.meeting?.time || '10:00',
      durationMin: level.meeting?.durationMin || (level.type === 'pulse' ? 15 : 45),
      place: level.meeting?.place || 'За домовленістю',
      icon: level.icon || 'meeting',
      agenda: level.meeting?.agenda || level.summary || '',
    });
  }
  for (const extra of content.extraEvents || []) {
    events.push({
      id: `${person.id}-${extra.id}`,
      levelId: null,
      title: extra.title,
      date: dateForDay(person.startDate, extra.day),
      time: extra.time,
      durationMin: extra.durationMin,
      place: extra.place,
      icon: extra.icon || 'checkin',
      agenda: extra.agenda || '',
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return events;
}

export function endTime(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function eventToIcs(event) {
  const stamp = event.date.replaceAll('-', '');
  const start = `${stamp}T${event.time.replace(':', '')}00`;
  const end = `${stamp}T${endTime(event.time, event.durationMin).replace(':', '')}00`;
  const escape = (value) => String(value || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roshen Adaptatsiya//UK',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.id}@roshen-onboarding`,
    `DTSTAMP:${stamp}T090000Z`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escape(event.title)}`,
    `LOCATION:${escape(event.place)}`,
    `DESCRIPTION:${escape(event.agenda)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function rankFor(xp, rewards) {
  const ranks = rewards.ranks || [];
  let current = ranks[0] || { xp: 0, name: 'Новачок' };
  let next = null;
  for (const rank of ranks) {
    if (xp >= rank.xp) current = rank;
    else if (!next) next = rank;
  }
  return { current, next };
}

export function pulseAverages(people, pulses, wave) {
  const axes = ['tools', 'productivity', 'culture'];
  const rows = people
    .map((person) => pulses?.[person.id]?.[wave])
    .filter((row) => row && typeof row.tools === 'number');
  return axes.map((axis) => {
    if (!rows.length) return { axis, avg: null, n: 0 };
    const avg = rows.reduce((sum, row) => sum + row[axis], 0) / rows.length;
    return { axis, avg, n: rows.length };
  });
}

export const PULSE_AXES = [
  { id: 'tools', label: 'Інструменти' },
  { id: 'productivity', label: 'Продуктивність' },
  { id: 'culture', label: 'Культура' },
];

export function riskFlags({ person, dayNum, levels, worlds, progress, prep, pulses, rewards }) {
  const flags = [];
  const actions = ['discuss_role', 'assign_buddy', 'networking', 'schedule_checkins', 'open_dialogue'];
  const done = actions.filter((id) => prep?.[id]).length;
  if (done < actions.length && dayNum >= 1) {
    flags.push({ id: 'level0', severity: 'high', text: 'Рівень 0 керівника не закрито до старту' });
  } else if (done < actions.length) {
    flags.push({ id: 'level0', severity: 'watch', text: 'До старту ще відкриті пункти керівника' });
  }
  let overdue = 0;
  for (const level of levels) {
    let unlocked = false;
    if (level.worldId === 'horizon') unlocked = dayNum >= (level.unlockDay ?? 365);
    else {
      const index = worlds.findIndex((world) => world.id === level.worldId);
      if (index >= 0) unlocked = isWorldUnlocked(worlds[index], index, worlds, levels, progress, dayNum, rewards);
    }
    if (isOverdue(level, progress[level.id], dayNum, unlocked)) overdue += 1;
  }
  if (overdue) {
    flags.push({
      id: 'overdue',
      severity: overdue >= 3 ? 'high' : 'watch',
      text: `Прострочено завдань: ${overdue}`,
    });
  }
  if (dayNum >= 2 && !progress['w1-factory']?.completed) {
    flags.push({ id: 'factory', severity: 'high', text: 'Не пройдена зміна на фабриці' });
  }
  const missedBuddy = levels.some((level) => level.buddyWeekly && level.dueDay <= dayNum && !progress[level.id]?.completed && dayNum >= 8);
  if (missedBuddy) flags.push({ id: 'buddy', severity: 'watch', text: 'Є невідбута щотижнева зустріч із buddy' });
  for (const wave of ['30', '90', '365']) {
    const row = pulses?.[wave];
    if (!row) continue;
    for (const axis of PULSE_AXES) {
      if (typeof row[axis.id] === 'number' && row[axis.id] <= 2) {
        flags.push({ id: `pulse-${wave}-${axis.id}`, severity: 'watch', text: `Пульс ${wave}: низько «${axis.label}»` });
      }
    }
  }
  return flags;
}

export function guideTip({ dailyClaimed, overdueCount, current }) {
  if (!dailyClaimed) return 'Щоденний дарунок уже на місці: коротенький квіз про продукт або нове знайомство. Пропуск дня нічого не спалює.';
  if (overdueCount) return 'Є крок із минулою датою. Це не штраф і не втрата зірок, які вже є — просто наступна справа, коли буде хвилина.';
  if (current?.buddyWeekly) return 'Щотижнева зустріч із buddy тримає контекст. Обери одну тему заздалегідь, лічильник зустрічей живе в профілі.';
  if (current?.id === 'w3-week2-nudge') return 'Другий тиждень: постав питання, попроси фідбек і домовся про регулярні 1:1.';
  if (current?.id === 'w1-factory') return 'Зміна на фабриці і дегустація — обовʼязковий епізод першого дня. Це досвід продукту, не слайд.';
  return 'Наступний світ відкриється на 70% зірок або в свій календарний день. Застрягти на мапі неможливо.';
}

export function dailyOffer(content, asOf, met = []) {
  const n = Number(asOf.replaceAll('-', ''));
  if (n % 2 === 0) {
    const bank = content.dailyQuizzes || [];
    return { kind: 'quiz', quiz: bank[n % bank.length] };
  }
  const pool = content.acquaintances || [];
  const unseen = pool.filter((person) => !met.includes(person.id));
  const list = unseen.length ? unseen : pool;
  return { kind: 'acquaintance', person: list[n % list.length] };
}

export function freshState(content, rewards) {
  const me = content.people.find((person) => person.id === content.currentUserId);
  const progress = progressFromSeed(me, content.levels);
  let xp = 0;
  let candies = 0;
  for (const entry of Object.values(progress)) {
    const stars = computeStars(entry, rewards);
    const gain = payout(0, stars, rewards, true);
    xp += gain.xp;
    candies += gain.candies;
  }
  const hires = content.people.filter((person) => person.kind === 'hire');
  return {
    v: 1,
    progress,
    xp,
    candies,
    boosters: { hint: 1, expert: 0, skip: 0, ...(me.seedBoosters || {}) },
    streak: me.seedStreak || { count: 0, lastActive: null },
    helped: [],
    met: [],
    daily: null,
    absences: {
      sick: [...(me.absences?.sick || [])],
      vacation: [...(me.absences?.vacation || [])],
    },
    managerPrep: Object.fromEntries(hires.map((person) => [person.id, { ...(person.managerLevel0 || {}) }])),
    pulses: Object.fromEntries(hires.map((person) => [person.id, { ...(person.pulses || {}) }])),
    npcProgress: {},
    npcBoosters: {},
    requests: [],
    asOfOverride: null,
    toast: null,
  };
}

export function progressOf(person, content, state) {
  if (person.id === content.currentUserId) return state.progress;
  return mergeProgress(progressFromSeed(person, content.levels), state.npcProgress?.[person.id]);
}

function withToast(state, toast) {
  return { ...state, toast };
}

export function newlyEarnedBadges(rewards, prevProgress, nextProgress) {
  return (rewards.badges || []).filter((badge) => nextProgress[badge.levelId]?.completed && !prevProgress[badge.levelId]?.completed);
}

export function completeLevel(state, content, rewards, { levelId, quizScore = null, reflection } = {}) {
  const level = content.levels.find((item) => item.id === levelId);
  if (!level) return { ok: false, error: 'Немає такого рівня', state };
  const entry = state.progress[levelId] || { checks: {}, chapters: {}, reveals: {} };
  if (entry.completed) return { ok: false, error: 'Рівень уже закрито', state };
  if (level.type === 'checklist' && !entry.skipped) {
    const got = Object.values(entry.checks || {}).filter(Boolean).length;
    if (got < (level.items?.length || 0)) return { ok: false, error: 'Познач усі пункти', state };
  }
  if ((level.type === 'quiz' || level.type === 'match3') && typeof (quizScore ?? entry.quizScore) !== 'number') {
    return { ok: false, error: 'Спочатку пройди завдання', state };
  }
  if (level.type === 'video') {
    const got = Object.values(entry.chapters || {}).filter(Boolean).length;
    if (got < (level.chapters?.length || 0)) return { ok: false, error: 'Відкрий усі частини', state };
  }
  const me = content.people.find((person) => person.id === content.currentUserId);
  const asOf = state.asOfOverride || content.meta.asOf;
  const dayNum = dayNumber(me.startDate, asOf);
  const onTime = Boolean(level.bonus) || typeof level.dueDay !== 'number' || dayNum <= level.dueDay;
  const reminded = !level.bonus && typeof level.reminderDay === 'number' && dayNum >= level.reminderDay;
  const nextEntry = {
    ...entry,
    completed: true,
    completedAt: asOf,
    onTime,
    noReminders: !reminded,
    quizScore: quizScore ?? entry.quizScore ?? null,
    reflection: (reflection ?? entry.reflection ?? '').trim(),
    confirmed: entry.confirmed || false,
  };
  const stars = computeStars(nextEntry, rewards);
  const gain = payout(0, stars, rewards, true);
  const progress = { ...state.progress, [levelId]: nextEntry };
  const badges = newlyEarnedBadges(rewards, state.progress, progress);
  const next = withToast({
    ...state,
    progress,
    xp: state.xp + gain.xp,
    candies: state.candies + gain.candies,
    streak: touchStreak(state.streak, state.absences, asOf, rewards),
  }, {
    kind: 'level',
    levelId,
    title: level.title,
    stars,
    xp: gain.xp,
    candies: gain.candies,
    badges,
  });
  return { ok: true, state: next };
}

export function patchEntry(state, levelId, patch) {
  const entry = state.progress[levelId] || { checks: {}, chapters: {}, reveals: {} };
  return {
    ...state,
    progress: { ...state.progress, [levelId]: { ...entry, ...patch } },
  };
}

export function saveReflection(state, rewards, { levelId, reflection }) {
  const entry = state.progress[levelId];
  if (!entry?.completed) {
    return { ok: true, state: patchEntry(state, levelId, { reflection }) };
  }
  const prevStars = computeStars(entry, rewards);
  const nextEntry = { ...entry, reflection: reflection.trim() };
  const nextStars = computeStars(nextEntry, rewards);
  const gain = payout(prevStars, nextStars, rewards, false);
  const progress = { ...state.progress, [levelId]: nextEntry };
  return {
    ok: true,
    state: {
      ...state,
      progress,
      xp: state.xp + gain.xp,
      candies: state.candies + gain.candies,
      toast: nextStars > prevStars ? {
        kind: 'stars',
        levelId,
        title: 'Рефлексію збережено',
        stars: nextStars,
        xp: gain.xp,
        candies: gain.candies,
        badges: [],
      } : state.toast,
    },
  };
}

export function confirmStar(state, content, rewards, { personId, levelId, by }) {
  const person = content.people.find((item) => item.id === personId);
  if (!person) return { ok: false, error: 'Немає людини', state };
  if (personId === content.currentUserId) {
    const entry = state.progress[levelId];
    if (!entry?.completed) return { ok: false, error: 'Спочатку рівень має бути закрито', state };
    const prevStars = computeStars(entry, rewards);
    const nextEntry = { ...entry, confirmed: true, confirmedBy: by || 'buddy' };
    const nextStars = computeStars(nextEntry, rewards);
    const gain = payout(prevStars, nextStars, rewards, false);
    return {
      ok: true,
      state: {
        ...state,
        progress: { ...state.progress, [levelId]: nextEntry },
        xp: state.xp + gain.xp,
        candies: state.candies + gain.candies,
        toast: { kind: 'stars', levelId, title: 'Якість підтверджено', stars: nextStars, xp: gain.xp, candies: gain.candies, badges: [] },
      },
    };
  }
  const base = progressOf(person, content, state);
  const entry = base[levelId];
  if (!entry?.completed) return { ok: false, error: 'Спочатку рівень має бути закрито', state };
  const npcProgress = {
    ...state.npcProgress,
    [personId]: {
      ...(state.npcProgress[personId] || {}),
      [levelId]: { ...entry, confirmed: true, confirmedBy: by || 'manager' },
    },
  };
  return { ok: true, state: { ...state, npcProgress } };
}

export function useBooster(state, content, rewards, { levelId, boosterId }) {
  const level = content.levels.find((item) => item.id === levelId);
  const owned = state.boosters[boosterId] || 0;
  if (!level) return { ok: false, error: 'Немає рівня', state };
  if (owned < 1) return { ok: false, error: 'Цього бустера немає в кишені', state };
  const entry = state.progress[levelId] || { checks: {}, chapters: {}, reveals: {} };
  if (boosterId === 'skip') {
    if (!level.routine) return { ok: false, error: 'Так можна закрити лише рутинний чекліст', state };
    const checks = Object.fromEntries((level.items || []).map((_, index) => [index, true]));
    const spent = { ...state, boosters: { ...state.boosters, skip: owned - 1 }, progress: { ...state.progress, [levelId]: { ...entry, checks, skipped: true } } };
    return completeLevel(spent, content, rewards, { levelId });
  }
  if (entry.reveals?.[boosterId]) return { ok: true, state };
  return {
    ok: true,
    state: {
      ...state,
      boosters: { ...state.boosters, [boosterId]: owned - 1 },
      progress: {
        ...state.progress,
        [levelId]: { ...entry, reveals: { ...(entry.reveals || {}), [boosterId]: true } },
      },
    },
  };
}

export function buyItem(state, rewards, { itemId, asOf }) {
  const item = [...rewards.boosters, ...rewards.rewards].find((entry) => entry.id === itemId);
  if (!item) return { ok: false, error: 'Немає такої нагороди', state };
  if (state.candies < item.cost) return { ok: false, error: 'Не вистачає цукерок', state };
  const next = { ...state, candies: state.candies - item.cost };
  if (item.kind === 'hr-request') {
    next.requests = [...state.requests, { id: `req-${item.id}-${state.requests.length + 1}`, rewardId: item.id, status: 'new', at: asOf }];
    next.toast = { kind: 'note', title: 'Заявку передано HR', text: item.name, stars: 0, xp: 0, candies: 0, badges: [] };
  } else {
    next.boosters = { ...state.boosters, [item.id]: (state.boosters[item.id] || 0) + 1 };
    next.toast = { kind: 'note', title: 'Бустер у кишені', text: item.name, stars: 0, xp: 0, candies: 0, badges: [] };
  }
  return { ok: true, state: next };
}

export function helpPerson(state, content, rewards, { personId }) {
  if (personId === content.currentUserId) return { ok: false, error: 'Себе підтримувати не треба', state };
  if (state.helped.includes(personId)) return { ok: false, error: 'Ти вже підтримала цю людину', state };
  const helped = [...state.helped, personId];
  const grantBooster = helped.length % rewards.help.boosterEvery === 0;
  const boosterId = rewards.help.boosterId;
  const asOf = state.asOfOverride || content.meta.asOf;
  return {
    ok: true,
    state: {
      ...state,
      helped,
      candies: state.candies + rewards.candies.helpColleague,
      xp: state.xp + rewards.xp.help,
      boosters: grantBooster ? { ...state.boosters, [boosterId]: (state.boosters[boosterId] || 0) + 1 } : state.boosters,
      streak: touchStreak(state.streak, state.absences, asOf, rewards),
      toast: {
        kind: 'note',
        title: 'Дякую, це теж адаптація',
        text: grantBooster ? `+${rewards.candies.helpColleague} цукерок і підказка` : `+${rewards.candies.helpColleague} цукерок`,
        stars: 0,
        xp: rewards.xp.help,
        candies: rewards.candies.helpColleague,
        badges: [],
      },
    },
  };
}

export function giveBooster(state, content, { personId, boosterId }) {
  if (!['hint', 'expert', 'skip'].includes(boosterId)) return { ok: false, error: 'Немає такого бустера', state };
  if (personId === content.currentUserId) {
    return {
      ok: true,
      state: { ...state, boosters: { ...state.boosters, [boosterId]: (state.boosters[boosterId] || 0) + 1 } },
    };
  }
  const bag = state.npcBoosters[personId] || { hint: 0, expert: 0, skip: 0 };
  return {
    ok: true,
    state: {
      ...state,
      npcBoosters: { ...state.npcBoosters, [personId]: { ...bag, [boosterId]: (bag[boosterId] || 0) + 1 } },
    },
  };
}

export function savePulse(state, content, rewards, { personId, levelId, wave, tools, productivity, culture, comment }) {
  if ([tools, productivity, culture].some((value) => typeof value !== 'number')) {
    return { ok: false, error: 'Постав оцінку на всіх трьох осях', state };
  }
  const row = { tools, productivity, culture, comment: comment || '' };
  const pulses = {
    ...state.pulses,
    [personId]: { ...(state.pulses[personId] || {}), [wave]: row },
  };
  if (personId !== content.currentUserId) return { ok: true, state: { ...state, pulses } };
  if (state.progress[levelId]?.completed) {
    const entry = { ...state.progress[levelId], reflection: comment || state.progress[levelId].reflection || '' };
    return { ok: true, state: { ...state, pulses, progress: { ...state.progress, [levelId]: entry } } };
  }
  const seeded = {
    ...state,
    pulses,
    progress: {
      ...state.progress,
      [levelId]: { ...(state.progress[levelId] || {}), reflection: comment || '' },
    },
  };
  const result = completeLevel(seeded, content, rewards, { levelId, reflection: comment || '' });
  if (!result.ok) return result;
  return { ok: true, state: { ...result.state, pulses } };
}

export function claimDaily(state, content, rewards, { correct }) {
  const asOf = state.asOfOverride || content.meta.asOf;
  if (state.daily?.date === asOf) return { ok: false, error: 'Сьогоднішній дарунок уже забрано', state };
  const offer = dailyOffer(content, asOf, state.met);
  const bonus = offer.kind === 'quiz' && correct ? rewards.candies.dailyCorrectBonus : 0;
  const candies = rewards.candies.daily + bonus;
  const met = offer.kind === 'acquaintance' ? [...new Set([...state.met, offer.person.id])] : state.met;
  return {
    ok: true,
    state: {
      ...state,
      met,
      candies: state.candies + candies,
      daily: { date: asOf, kind: offer.kind, correct: Boolean(correct), acquaintanceId: offer.person?.id || null },
      streak: touchStreak(state.streak, state.absences, asOf, rewards),
      toast: { kind: 'note', title: 'Щоденний дарунок', text: `+${candies} цукерок`, stars: 0, xp: 0, candies, badges: [] },
    },
  };
}

export const CANDIES = ['praline', 'caramel', 'berry', 'mint', 'wafer'];

export function findMatches(board) {
  const height = board.length;
  const width = board[0].length;
  const mask = Array.from({ length: height }, () => Array(width).fill(false));
  let count = 0;
  const take = (y, x) => {
    if (!mask[y][x]) count += 1;
    mask[y][x] = true;
  };
  for (let y = 0; y < height; y += 1) {
    let run = 1;
    for (let x = 1; x <= width; x += 1) {
      if (x < width && board[y][x] && board[y][x] === board[y][x - 1]) run += 1;
      else {
        if (run >= 3) for (let k = 0; k < run; k += 1) take(y, x - 1 - k);
        run = 1;
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let run = 1;
    for (let y = 1; y <= height; y += 1) {
      if (y < height && board[y][x] && board[y][x] === board[y - 1][x]) run += 1;
      else {
        if (run >= 3) for (let k = 0; k < run; k += 1) take(y - 1 - k, x);
        run = 1;
      }
    }
  }
  return { mask, count };
}

function wouldMatch(row, board, x, y, type) {
  if (x >= 2 && row[x - 1] === type && row[x - 2] === type) return true;
  if (y >= 2 && board[y - 1][x] === type && board[y - 2][x] === type) return true;
  return false;
}

export function hasMove(board) {
  const height = board.length;
  const width = board[0].length;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const next = board.map((row) => row.slice());
        [next[y][x], next[ny][nx]] = [next[ny][nx], next[y][x]];
        if (findMatches(next).count) return true;
      }
    }
  }
  return false;
}

export function createBoard(rows, cols, rng = Math.random) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const board = [];
    for (let y = 0; y < rows; y += 1) {
      const row = [];
      for (let x = 0; x < cols; x += 1) {
        let type = CANDIES[Math.floor(rng() * CANDIES.length)];
        let guard = 0;
        while (wouldMatch(row, board, x, y, type) && guard < 8) {
          type = CANDIES[Math.floor(rng() * CANDIES.length)];
          guard += 1;
        }
        row.push(type);
      }
      board.push(row);
    }
    if (!findMatches(board).count && hasMove(board)) return board;
  }
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => CANDIES[(x + y) % CANDIES.length]));
}

function dropAndFill(board, rng) {
  const height = board.length;
  const width = board[0].length;
  const next = Array.from({ length: height }, () => Array(width).fill(null));
  for (let x = 0; x < width; x += 1) {
    let write = height - 1;
    for (let y = height - 1; y >= 0; y -= 1) {
      if (board[y][x]) {
        next[write][x] = board[y][x];
        write -= 1;
      }
    }
    for (let y = write; y >= 0; y -= 1) next[y][x] = CANDIES[Math.floor(rng() * CANDIES.length)];
  }
  return next;
}

export function resolveBoard(board, rng = Math.random) {
  let current = board.map((row) => row.slice());
  let score = 0;
  let cascades = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const { mask, count } = findMatches(current);
    if (!count) break;
    cascades += 1;
    score += count * 10 + (count >= 4 ? 20 : 0);
    current = current.map((row, y) => row.map((cell, x) => (mask[y][x] ? null : cell)));
    current = dropAndFill(current, rng);
  }
  return { board: current, score, cascades };
}

function decorateLevel(level, mine, unlocked, friendsByLevel, rewards) {
  const entry = mine.progress[level.id] || null;
  return {
    ...level,
    entry,
    stars: computeStars(entry, rewards),
    completed: Boolean(entry?.completed),
    overdue: isOverdue(level, entry, mine.dayNum, unlocked),
    locked: !unlocked,
    friends: friendsByLevel[level.id] || [],
    current: mine.here === level.id,
  };
}

export function assemble(content, rewards, state) {
  const asOf = state.asOfOverride || content.meta.asOf;
  const me = content.people.find((person) => person.id === content.currentUserId);
  const hires = content.people.filter((person) => person.kind === 'hire');
  const snapshots = hires.map((person) => {
    const progress = progressOf(person, content, state);
    const dayNum = dayNumber(person.startDate, asOf);
    const here = currentLevelId(person, content, rewards, progress, asOf);
    const program = programLevels(content.levels);
    const done = program.filter((level) => progress[level.id]?.completed).length;
    const prep = state.managerPrep[person.id] || person.managerLevel0 || {};
    const pulse = state.pulses[person.id] || {};
    const overdue = content.levels.filter((level) => {
      let unlocked = false;
      if (level.worldId === 'horizon') unlocked = dayNum >= (level.unlockDay ?? 365);
      else {
        const index = content.worlds.findIndex((world) => world.id === level.worldId);
        unlocked = index >= 0 && isWorldUnlocked(content.worlds[index], index, content.worlds, content.levels, progress, dayNum, rewards);
      }
      return isOverdue(level, progress[level.id], dayNum, unlocked);
    });
    return {
      person,
      progress,
      dayNum,
      here,
      buddy: content.people.find((item) => item.id === person.buddyId) || null,
      manager: content.people.find((item) => item.id === person.managerId) || null,
      prep,
      pulse,
      percent: program.length ? Math.round((done / program.length) * 100) : 0,
      stars: program.reduce((sum, level) => sum + computeStars(progress[level.id], rewards), 0),
      starsMax: program.length * 3,
      overdue,
      flags: riskFlags({
        person,
        dayNum,
        levels: content.levels,
        worlds: content.worlds,
        progress,
        prep,
        pulses: pulse,
        rewards,
      }),
      buddies: buddyStats(content.levels, progress),
    };
  });
  const mine = snapshots.find((item) => item.person.id === me.id);
  const friendsByLevel = {};
  for (const snap of snapshots) {
    if (!snap.here || snap.person.id === me.id) continue;
    if (!friendsByLevel[snap.here]) friendsByLevel[snap.here] = [];
    friendsByLevel[snap.here].push(snap.person);
  }
  const worlds = content.worlds.map((world, index) => {
    const unlocked = isWorldUnlocked(world, index, content.worlds, content.levels, mine.progress, mine.dayNum, rewards);
    const levels = content.levels
      .filter((level) => level.worldId === world.id)
      .map((level) => decorateLevel(level, mine, unlocked, friendsByLevel, rewards));
    const required = levels.filter((level) => !level.bonus);
    return {
      ...world,
      index,
      unlocked,
      unlockDate: dateForDay(me.startDate, world.unlockDay),
      earnedStars: required.reduce((sum, level) => sum + level.stars, 0),
      maxStars: required.length * 3,
      levels,
    };
  });
  const horizonSource = content.levels.find((level) => level.worldId === 'horizon');
  const horizon = horizonSource
    ? {
      ...decorateLevel(horizonSource, mine, mine.dayNum >= (horizonSource.unlockDay ?? 365), friendsByLevel, rewards),
      unlockDate: dateForDay(me.startDate, horizonSource.unlockDay ?? 365),
    }
    : null;
  const flat = [...worlds.flatMap((world) => world.levels), horizon].filter(Boolean);
  const current = flat.find((level) => level.id === mine.here) || null;
  const cohortDone = snapshots.filter((snap) => snap.progress[content.cohortGoal.levelId]?.completed).length;
  return {
    asOf,
    me,
    mine,
    snapshots,
    worlds,
    horizon,
    current,
    events: calendarEvents(me, content),
    cohort: { ...content.cohortGoal, done: cohortDone, total: snapshots.length },
    badges: (rewards.badges || []).map((badge) => ({
      ...badge,
      earned: Boolean(mine.progress[badge.levelId]?.completed),
    })),
    overdueCount: mine.overdue.length,
    dailyClaimed: state.daily?.date === asOf,
    tip: guideTip({ dailyClaimed: state.daily?.date === asOf, overdueCount: mine.overdue.length, current }),
    rank: rankFor(state.xp, rewards),
    streak: streakView(state.streak, state.absences, asOf, rewards),
    percent: mine.percent,
  };
}

export function buildJourney(person, content, rewards, state) {
  const asOf = state.asOfOverride || content.meta.asOf;
  const progress = progressOf(person, content, state);
  const dayNum = dayNumber(person.startDate, asOf);
  const worlds = content.worlds.map((world, index) => {
    const unlocked = isWorldUnlocked(world, index, content.worlds, content.levels, progress, dayNum, rewards);
    const levels = content.levels.filter((level) => level.worldId === world.id);
    const required = levels.filter((level) => !level.bonus);
    const earnedStars = required.reduce((sum, level) => sum + computeStars(progress[level.id], rewards), 0);
    const maxStars = required.length * 3;
    return {
      ...world,
      index,
      unlocked,
      unlockDate: dateForDay(person.startDate, world.unlockDay),
      earnedStars,
      maxStars,
      levels,
    };
  });
  const here = person.id === content.currentUserId ? currentLevelId(person, content, rewards, progress, asOf) : null;
  return { asOf, dayNum, progress, worlds, here };
}
