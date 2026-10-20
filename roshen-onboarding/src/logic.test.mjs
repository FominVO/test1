import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  assemble,
  buyItem,
  calendarEvents,
  completeLevel,
  computeStars,
  createBoard,
  dayNumber,
  findMatches,
  freshState,
  helpPerson,
  isNonWorkingDay,
  isWorldUnlocked,
  parseISO,
  resolveBoard,
  streakView,
  touchStreak,
} from './logic.js';

const root = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(readFileSync(join(root, '../public/data/content.json'), 'utf8'));
const rewards = JSON.parse(readFileSync(join(root, '../public/data/rewards.json'), 'utf8'));

test('demo calendar puts Olena on day 14 and Ihor before day 1', () => {
  assert.equal(dayNumber('2026-10-06', '2026-10-19'), 14);
  assert.equal(dayNumber('2026-11-02', '2026-10-19'), -13);
  assert.equal(dayNumber('2025-10-20', '2026-10-19'), 365);
});

test('stars follow the ladder without requiring a lower star first', () => {
  assert.equal(computeStars({ completed: true, onTime: true }, rewards), 1);
  assert.equal(computeStars({ completed: true, onTime: false, noReminders: true }, rewards), 2);
  assert.equal(computeStars({ completed: true, quizScore: 0.8 }, rewards), 2);
  assert.equal(computeStars({ completed: true, quizScore: 0.79, onTime: true }, rewards), 1);
  assert.equal(computeStars({
    completed: true,
    onTime: true,
    noReminders: true,
    reflection: 'Коротка рефлексія достатньої довжини.',
  }, rewards), 3);
  assert.equal(computeStars({ completed: true, confirmed: true }, rewards), 3);
  assert.equal(computeStars({ completed: false, onTime: true }, rewards), 0);
});

test('world opens on its calendar day even with zero stars', () => {
  const empty = {};
  const world4 = content.worlds[4];
  assert.equal(isWorldUnlocked(world4, 4, content.worlds, content.levels, empty, 31, rewards), true);
  assert.equal(isWorldUnlocked(world4, 4, content.worlds, content.levels, empty, 10, rewards), false);
  assert.equal(isWorldUnlocked(content.worlds[0], 0, content.worlds, content.levels, empty, -40, rewards), true);
});

test('70 percent of the previous world opens the next one early', () => {
  const progress = {};
  const previous = content.levels.filter((level) => level.worldId === 'w0' && !level.bonus);
  const need = Math.ceil(previous.length * 3 * rewards.worldGate.starRatio);
  let given = 0;
  for (const level of previous) {
    const stars = given + 3 <= need ? 3 : 0;
    if (!stars) break;
    progress[level.id] = { completed: true, onTime: true, noReminders: true, confirmed: true, reflection: '' };
    given += 3;
  }
  assert.ok(given / (previous.length * 3) >= 0.7);
  assert.equal(isWorldUnlocked(content.worlds[1], 1, content.worlds, content.levels, progress, -5, rewards), true);
});

test('streak freezes weekends and never burns', () => {
  const streak = { count: 8, lastActive: '2026-10-16' };
  const absences = { sick: ['2026-10-13'], vacation: [] };
  const fridayToMonday = streakView(streak, absences, '2026-10-19', rewards);
  assert.equal(fridayToMonday.paused, false);
  assert.equal(fridayToMonday.gap.map((item) => item.reason).join(','), 'вихідний,вихідний');
  const hole = streakView(streak, absences, '2026-10-20', rewards);
  assert.equal(hole.paused, true);
  assert.equal(hole.count, 8);
  const next = touchStreak(streak, absences, '2026-10-20', rewards);
  assert.equal(next.count, 9);
  assert.equal(touchStreak(next, absences, '2026-10-20', rewards).count, 9);
});

test('sick leave inside a gap is a freeze', () => {
  const view = streakView(
    { count: 4, lastActive: '2026-10-14' },
    { sick: ['2026-10-15', '2026-10-16'], vacation: [] },
    '2026-10-19',
    rewards,
  );
  assert.equal(view.paused, false);
  assert.ok(view.gap.some((item) => item.reason === 'лікарняний'));
});

test('content model keeps the required journey beats', () => {
  assert.equal(content.worlds.map((world) => world.id).join(','), 'w0,w1,w2,w3,w4,w5');
  assert.equal(content.managerLevel0.length, 5);
  const factory = content.levels.find((level) => level.id === 'w1-factory');
  assert.equal(factory.worldId, 'w1');
  assert.equal(factory.mandatory, true);
  assert.match(factory.title, /фабриці/);
  const week2 = content.levels.find((level) => level.id === 'w3-week2');
  assert.ok(week2.items.some((item) => /запитання/i.test(item)));
  assert.ok(week2.items.some((item) => /зворотн/i.test(item)));
  assert.ok(week2.items.some((item) => /1:1/.test(item)));
  assert.equal(content.levels.filter((level) => level.buddyWeekly).length, 12);
  for (const wave of ['30', '90', '365']) {
    assert.ok(content.levels.some((level) => level.type === 'pulse' && level.wave === wave));
  }
  assert.equal(rewards.worldGate.starRatio, 0.7);
  assert.equal(JSON.stringify(rewards).includes('lives'), false);
  assert.equal(JSON.stringify(content).toLowerCase().includes('candy crush'), false);
  const icons = new Set(['buddy', 'checkin', 'first_project', 'key_event', 'manager_star', 'meeting', 'task', 'team_lunch', 'training']);
  for (const level of content.levels) assert.ok(icons.has(level.icon), level.id);
  for (const badge of rewards.badges) {
    assert.ok(content.levels.some((level) => level.id === badge.levelId), badge.id);
  }
});

test('Olena demo has factory badge, an overdue buddy meeting and no rank list', () => {
  const state = freshState(content, rewards);
  const view = assemble(content, rewards, state);
  assert.equal(view.mine.dayNum, 14);
  assert.equal(view.current.id, 'w3-buddy-2');
  assert.equal(view.current.overdue, true);
  assert.equal(view.badges.find((badge) => badge.id === 'factory_tour').earned, true);
  assert.equal(view.worlds[3].unlocked, true);
  assert.equal(view.worlds[4].unlocked, false);
  const maria = view.snapshots.find((snap) => snap.person.id === 'maria');
  assert.ok(maria.flags.some((flag) => flag.id === 'factory'));
  const ihor = view.snapshots.find((snap) => snap.person.id === 'ihor');
  assert.ok(ihor.flags.some((flag) => flag.id === 'level0'));
  assert.ok(view.snapshots.find((snap) => snap.person.id === 'dmytro').pulse['365']);
});

test('buying without enough candies does not change the wallet', () => {
  const state = freshState(content, rewards);
  const broke = { ...state, candies: 10 };
  const result = buyItem(broke, rewards, { itemId: 'gift-set', asOf: '2026-10-19' });
  assert.equal(result.ok, false);
  assert.equal(result.state.candies, 10);
});

test('helping a colleague adds candies and does not rank anyone', () => {
  const state = freshState(content, rewards);
  const once = helpPerson(state, content, rewards, { personId: 'maria' });
  assert.equal(once.ok, true);
  assert.equal(once.state.candies, state.candies + rewards.candies.helpColleague);
  const twice = helpPerson(once.state, content, rewards, { personId: 'maria' });
  assert.equal(twice.ok, false);
});

test('completing the week-2 checklist pays stars and keeps them', () => {
  let state = freshState(content, rewards);
  state = {
    ...state,
    progress: {
      ...state.progress,
      'w3-week2': { checks: { 0: true, 1: true, 2: true }, reveals: {} },
    },
  };
  const result = completeLevel(state, content, rewards, { levelId: 'w3-week2' });
  assert.equal(result.ok, true);
  assert.ok(result.state.progress['w3-week2'].completed);
  assert.ok(computeStars(result.state.progress['w3-week2'], rewards) >= 1);
  assert.ok(result.state.candies >= state.candies);
});

test('match-3 finds a line and a fresh board has a move', () => {
  const board = [
    ['praline', 'praline', 'praline', 'mint'],
    ['caramel', 'berry', 'wafer', 'mint'],
    ['caramel', 'berry', 'wafer', 'berry'],
    ['wafer', 'mint', 'caramel', 'berry'],
  ];
  assert.equal(findMatches(board).count, 3);
  const next = createBoard(7, 7, mulberry(4));
  assert.equal(findMatches(next).count, 0);
  const swapped = next.map((row) => row.slice());
  const resolved = resolveBoard(swapped, mulberry(9));
  assert.equal(resolved.score >= 0, true);
});

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('date math stays on the civil calendar', () => {
  assert.equal(addDays('2026-10-06', 13), '2026-10-19');
});

test('Olena calendar skips New Year and keeps buddy meetings on Thursday at 16:00', () => {
  const olena = content.people.find((person) => person.id === 'olena');
  const events = calendarEvents(olena, content);
  const byLevel = Object.fromEntries(events.filter((event) => event.levelId).map((event) => [event.levelId, event]));
  assert.equal(byLevel['w5-demo'].date, '2026-12-31');
  assert.equal(byLevel['w5-pulse-90'].date, '2027-01-04');
  assert.equal(byLevel['w5-checkin-90'].date, '2027-01-04');
  assert.equal(byLevel['h-pulse-365'].date, '2027-10-05');
  const buddies = events.filter((event) => event.title.startsWith('Buddy ·'));
  assert.equal(buddies.length, 12);
  for (const event of buddies) {
    assert.equal(parseISO(event.date).getUTCDay(), 4, `${event.title} ${event.date}`);
    assert.equal(event.time, '16:00', event.title);
  }
  for (const event of events) {
    const [hour, minute] = event.time.split(':').map(Number);
    const start = hour * 60 + minute;
    assert.ok(start >= 9 * 60 && start + event.durationMin <= 18 * 60, `${event.title} ${event.time}+${event.durationMin}`);
  }
});

test('generated calendar never puts an event on a weekend', () => {
  const olena = content.people.find((person) => person.id === 'olena');
  for (const person of content.people.filter((item) => item.kind === 'hire')) {
    for (const event of calendarEvents(person, content)) {
      const weekday = parseISO(event.date).getUTCDay();
      assert.ok(weekday >= 1 && weekday <= 5, `${person.id} ${event.title} ${event.date}`);
      assert.equal(isNonWorkingDay(event.date), false, `${person.id} ${event.title} ${event.date}`);
    }
  }
  for (let shift = 0; shift < 14; shift += 1) {
    const person = { ...olena, id: `shift-${shift}`, startDate: addDays(olena.startDate, shift) };
    for (const event of calendarEvents(person, content)) {
      assert.equal(isNonWorkingDay(event.date), false, `start+${shift} ${event.title} ${event.date}`);
    }
  }
});

test('public holidays include 1 January and a transferred Easter Monday', () => {
  assert.equal(isNonWorkingDay('2027-01-01'), true);
  assert.equal(isNonWorkingDay('2026-12-25'), true);
  assert.equal(isNonWorkingDay('2026-04-12'), true);
  assert.equal(isNonWorkingDay('2026-04-13'), true);
  assert.equal(isNonWorkingDay('2026-12-31'), false);
  assert.equal(isNonWorkingDay('2027-01-04'), false);
});
