import { html } from '../core/html.js';
import { quiz, players, mapsIndex } from '../core/data.js';
import { setTitle, avatar, coverUrl, prefs, starsBadge, catChip, epigraph } from '../core/ui.js';
import { BOSS_SETS, TUGA_SET, RIVALRIES, pick as stablePick } from '../core/lore.js';
import { wysi } from '../core/fun.js';
import * as fmt from '../core/fmt.js';

const shuffle = list => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const pick = list => list[Math.floor(Math.random() * list.length)];

function copyButton(root, text) {
  const button = root.querySelector('#share');
  button?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied!';
    } catch {
      button.textContent = 'Couldn’t copy';
    }
  });
}

// ---- Hub ------------------------------------------------------------------------------------------------

function hub(root) {
  setTitle('Games');
  const best = prefs.get('guess-best', null);
  const streak = prefs.get('hilo-best', null);
  const daily = prefs.get('daily', null);
  const quizBest = prefs.get('quiz-best', null);
  root.innerHTML = String(html`
    <header class="page-head">
      <h1>Games</h1>
      ${epigraph('games')}
      <p>Quick games made from the community’s data. Your records are saved in this browser.</p>
    </header>
    <div class="grid grid-3 game-cards">
      <a class="card card-link" href="#/games/guess">
        <span class="game-art"><img class="game-art-blur" src="${coverUrl(BOSS_SETS[Math.floor(Date.now() / 864e5) % BOSS_SETS.length], 'card')}" alt="" width="400" height="140" loading="lazy" decoding="async"></span>
        <h2>Guess the map</h2>
        <p class="muted">Name the map from its blurred cover. <b>Daily:</b> one map a day, three tries, like the Discord’s Wordle but with fruit. <b>Practice:</b> ten rounds with a boss round at the end.</p>
        <p class="small faint" style="margin:0">${daily?.streak ? `Daily streak: ${daily.streak} ${daily.streak === 1 ? 'day' : 'days'}` : 'No daily streak yet.'}${best !== null ? ` · Practice record: ${best} of 30` : ''}</p>
      </a>
      <a class="card card-link" href="#/games/quiz">
        <span class="game-art"><img src="${coverUrl(TUGA_SET, 'card')}" alt="" width="400" height="140" loading="lazy" decoding="async"></span>
        <h2>Convert or specific?</h2>
        <p class="muted">The eternal argument, as a quiz. Or try “Overdose or Rain?” and name the difficulty from the cover and the stars.</p>
        <p class="small faint" style="margin:0">${quizBest !== null ? `Your record: ${quizBest} of 10` : 'You haven’t played yet.'}</p>
      </a>
      <a class="card card-link" href="#/games/higher-lower">
        <span class="game-art game-art-duel">${avatar(RIVALRIES[0][0], 'avatar-md')}<span class="duel-vs">vs</span>${avatar(RIVALRIES[0][1], 'avatar-md')}<small>${RIVALRIES[0][2]}</small></span>
        <h2>Higher or lower?</h2>
        <p class="muted">Who has more pp, more #1s or more plays? Guess whether the next player is higher or lower and keep the streak alive.</p>
        <p class="small faint" style="margin:0">${streak !== null ? `Your best streak: ${streak}` : 'You haven’t played yet.'}</p>
      </a>
    </div>
  `);
}

// ---- Guess the map: Daily (one map a day) or Practice (ten rounds) ------------------------------------------------

const guessModes = mode => html`<div class="chips" style="justify-content:center;margin-bottom:12px">
  <a class="chip ${mode === 'daily' ? 'active' : ''}" href="#/games/guess" ${mode === 'daily' ? html`aria-current="page"` : ''}>Daily</a>
  <a class="chip ${mode === 'practice' ? 'active' : ''}" href="#/games/guess?mode=practice" ${mode === 'practice' ? html`aria-current="page"` : ''}>Practice</a>
</div>`;

// The day turns at midnight in Lisbon, so everyone gets the same map on the same day.
const lisbonDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' });
const todayKey = (offsetDays = 0) => lisbonDay.format(Date.now() + offsetDays * 86400000);

async function dailyGame(root, isCurrent) {
  const { sets } = await quiz();
  if (!isCurrent()) return;
  setTitle('Guess the map · Daily');
  const today = todayKey();
  const pool = sets.slice(0, 300);
  const answer = stablePick(pool, `daily:${today}`);
  const options = shuffle([answer, ...shuffle(pool.filter(s => s[0] !== answer[0] && s[2] !== answer[2])).slice(0, 5)]);
  const saved = prefs.get('daily', { last: null, streak: 0, best: 0, result: null });
  const already = saved.last === today ? saved.result : null;
  let tries = 0;

  const yesterday = todayKey(-1);
  const finish = tried => {
    const won = tried > 0;
    const streak = won ? (saved.last === yesterday || saved.last === today ? saved.streak : 0) + (saved.last === today ? 0 : 1) : 0;
    prefs.set('daily', { last: today, streak, best: Math.max(streak, saved.best || 0), result: tried });
    return streak;
  };
  const verdict = tried => (tried === 1 ? 'First try. Show-off.' : tried === 2 ? 'Second try. Not bad.' : tried === 3 ? '3rd try gang.' : 'Unlucky, 1 miss. Back tomorrow.');

  const draw = (done, tried, streak) => {
    root.innerHTML = String(html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow"><a href="#/games">Games</a> · Guess the map · ${fmt.date(Date.parse(`${today}T12:00:00Z`) / 1000)}</span>
          <h1>Which map is today’s?</h1>
        </header>
        ${guessModes('daily')}
        <div class="scoreboard"><span>Tries left <b>${done ? '—' : 3 - tries}</b></span><span>Streak <b>${done ? streak : saved.last === yesterday || saved.last === today ? saved.streak : 0}</b></span></div>
        <div class="game-cover"><img id="cover" alt="Map cover (blurred)" src="${coverUrl(answer[0], 'cover')}" style="filter:${done ? 'none' : `blur(${BLUR[Math.min(tries, 2)]}px) saturate(1.2)`}"></div>
        <div class="game-options" id="options">${options.map((s, i) => html`<button class="option ${done && s === answer ? 'right' : ''}" type="button" data-i="${i}" ${done ? html`disabled` : ''}>${s[2]}<small>${s[1]}</small></button>`)}</div>
        ${done ? html`<p class="game-result ${tried ? 'right' : 'wrong'}">${verdict(tried)}</p>
          <p class="center muted small">${answer[1]} - ${answer[2]}, mapped by ${answer[3]}. A new map tomorrow.</p>
          <div class="btn-row" style="justify-content:center"><button class="btn" id="share" type="button">Copy result</button></div>` : ''}
      </div>`);
    if (done) copyButton(root, `Guess the map (daily) · PT-CTB ${today}: ${tried ? `${'🍎'.repeat(tried - 1)}🎯 (${tried}/3)` : '❌'} · streak ${streak}`);
  };

  if (already !== null) { draw(true, already, saved.streak); return; }
  draw(false);
  // Listen on the options list, which the next draw replaces, so nothing leaks onto other pages.
  root.querySelector('#options').addEventListener('click', e => {
    const button = e.target.closest('[data-i]');
    if (!button || button.disabled || !isCurrent()) return;
    tries++;
    if (options[Number(button.dataset.i)] === answer) { draw(true, tries, finish(tries)); return; }
    button.disabled = true;
    button.classList.add('wrong');
    if (tries >= 3) { draw(true, 0, finish(0)); return; }
    root.querySelector('#cover').style.filter = `blur(${BLUR[tries]}px) saturate(1.2)`;
    root.querySelector('.scoreboard b').textContent = String(3 - tries);
  });
}

// ---- Convert or specific? / Overdose or Rain? ---------------------------------------------------------------------

const QUIZ_MODES = {
  convert: {
    label: 'Convert or specific?',
    question: 'Is this a convert or a catch-specific map?',
    answers: [['c', 'Convert'], ['r', 'Specific']],
    pool: rows => rows.filter(r => r[3] && r[7] >= 3 && (r[6] === 'c' || r[6] === 'r')),
    answer: r => r[6],
    reveal: r => `[${r[4]}]`,
  },
  dose: {
    label: 'Overdose or Rain?',
    question: 'Overdose or Rain? Name the difficulty.',
    answers: [['overdose', 'Overdose'], ['rain', 'Rain']],
    pool: rows => rows.filter(r => r[3] && r[7] >= 2 && (/\boverdose\b/i.test(r[4]) !== /\brain\b/i.test(r[4]))),
    answer: r => (/\boverdose\b/i.test(r[4]) ? 'overdose' : 'rain'),
    reveal: r => `[${r[4]}]`,
  },
};

async function quizGame(root, query, isCurrent) {
  const rows = await mapsIndex();
  if (!isCurrent()) return;
  const mode = QUIZ_MODES[query.mode] ? query.mode : 'convert';
  const m = QUIZ_MODES[mode];
  setTitle(m.label);
  const deck = shuffle(m.pool(rows)).slice(0, 10);
  let round = 0, score = 0;

  const draw = (picked = null) => {
    const r = deck[round];
    const right = picked !== null && picked === m.answer(r);
    root.innerHTML = String(html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow"><a href="#/games">Games</a> · ${m.label}</span>
          <h1>${m.question}</h1>
          <div class="chips" style="justify-content:center">${Object.entries(QUIZ_MODES).map(([k, v]) => html`<a class="chip ${k === mode ? 'active' : ''}" href="#/games/quiz?mode=${k}">${v.label}</a>`)}</div>
        </header>
        <div class="scoreboard"><span>Round <b>${round + 1}<small>/${deck.length}</small></b></span><span>Points <b>${score}</b></span></div>
        <div class="game-cover"><img src="${coverUrl(r[1], 'cover')}" alt="Map cover" onerror="this.style.visibility='hidden'"></div>
        <p class="center" style="margin:12px 0 0"><b>${r[2]} - ${r[3]}</b> ${starsBadge(r[5])}${mode === 'convert' ? html` <span class="faint">[${r[4]}]</span>` : ''}</p>
        <div class="btn-row" style="justify-content:center;margin-top:16px">
          ${picked === null
            ? m.answers.map(([k, label]) => html`<button class="btn btn-primary" type="button" data-pick="${k}">${label}</button>`)
            : html`<button class="btn btn-primary" id="next" type="button">${round + 1 >= deck.length ? 'See result' : 'Next →'}</button>`}
        </div>
        ${picked !== null ? html`<p class="game-result ${right ? 'right' : 'wrong'}">${right ? 'Right!' : 'Unlucky, 1 miss.'} <span class="muted">${catChip(r[6])} ${m.reveal(r)}</span></p>` : ''}
      </div>`);
    root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.pick === m.answer(r)) score++;
      draw(b.dataset.pick);
    }));
    root.querySelector('#next')?.addEventListener('click', () => {
      round++;
      if (round < deck.length) { draw(); return; }
      prefs.set('quiz-best', Math.max(score, prefs.get('quiz-best', 0)));
      root.querySelector('.game').innerHTML = String(html`<div class="card center" style="padding:36px">
        <span class="eyebrow">${m.label}</span>
        <div class="game-score">${score}<small>/ ${deck.length}</small></div>
        <p class="muted">${score >= 9 ? 'You’ve clearly had this argument before.' : score >= 6 ? 'Not bad.' : 'Skill issue. Try again?'}</p>
        <div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href="#/games/quiz?mode=${mode}&r=${Date.now()}">Play again</a></div>
      </div>`);
    });
  };
  if (!deck.length) { root.innerHTML = String(html`<div class="empty">There aren’t enough maps for this quiz yet.</div>`); return; }
  draw();
}

// ---- Guess the map -----------------------------------------------------------------------------------------

const ROUNDS = 10;
const BLUR = [26, 14, 6]; // px per hint level; points = 3 - level

async function guessGame(root, isCurrent) {
  const { sets } = await quiz();
  if (!isCurrent()) return;
  setTitle('Guess the map · Practice');
  if (sets.length < 4) {
    root.innerHTML = String(html`<div class="empty">There aren’t enough maps for this game yet.</div>`);
    return;
  }

  // sets rows: [setId, artist, title, creator, playersHere]
  // The last round is a boss map; once per browser session, "Eu estou aqui" sneaks in as a bonus round.
  const special = new Map();
  const deck = shuffle(sets.filter(s => !BOSS_SETS.includes(s[0]) && s[0] !== TUGA_SET));
  const tuga = sets.find(s => s[0] === TUGA_SET);
  let tugaShown = false;
  try { tugaShown = sessionStorage.getItem('ptctb:tuga') === '1'; sessionStorage.setItem('ptctb:tuga', '1'); } catch { /* private mode */ }
  if (tuga && !tugaShown) { deck.splice(2 + Math.floor(Math.random() * 6), 0, tuga); special.set(tuga[0], 'Tuga bonus 🇵🇹'); }
  const bosses = sets.filter(s => BOSS_SETS.includes(s[0]));
  if (bosses.length) { const boss = pick(bosses); deck.splice(ROUNDS - 1, 0, boss); special.set(boss[0], 'Boss round'); }
  let round = 0, score = 0, level = 0, current = null, options = [], answered = false;

  root.innerHTML = String(html`
    <div class="game">
      <header class="page-head center">
        <span class="eyebrow"><a href="#/games">Games</a> · Guess the map</span>
        <h1>Which map is this?</h1>
      </header>
      ${guessModes('practice')}
      <div class="scoreboard"><span>Round <b><span id="round">1</span><small>/${ROUNDS}</small></b></span><span>Points <b id="score">0</b></span><span>Worth <b id="worth">3</b></span></div>
      <p class="center special-round" id="special"></p>
      <div class="game-cover"><img id="cover" alt="Map cover (blurred)"></div>
      <div class="game-options" id="options"></div>
      <div class="btn-row" style="justify-content:center;margin-top:16px">
        <button class="btn" id="hint" type="button">Less blur (−1 point)</button>
        <button class="btn btn-primary hidden" id="next" type="button">Next →</button>
      </div>
      <p class="center muted small" id="reveal" style="margin-top:14px"></p>
    </div>
  `);

  const img = root.querySelector('#cover');
  const optionsEl = root.querySelector('#options');
  const hint = root.querySelector('#hint');
  const next = root.querySelector('#next');
  const reveal = root.querySelector('#reveal');

  const label = s => html`${s[2]}<small>${s[1]}</small>`;
  const drawStatus = () => {
    root.querySelector('#round').textContent = String(round + 1);
    root.querySelector('#score').textContent = String(score);
    root.querySelector('#worth').textContent = answered ? '—' : String(3 - level);
    img.style.filter = answered ? 'none' : `blur(${BLUR[level]}px) saturate(1.2)`;
    hint.disabled = answered || level >= BLUR.length - 1;
  };

  const start = () => {
    answered = false;
    level = 0;
    current = deck[round % deck.length];
    root.querySelector('#special').textContent = special.get(current[0]) ?? '';
    const others = shuffle(deck.filter(s => s[0] !== current[0] && s[2] !== current[2])).slice(0, 3);
    options = shuffle([current, ...others]);
    img.src = coverUrl(current[0], 'cover');
    optionsEl.innerHTML = String(html`${options.map((s, i) => html`<button class="option" type="button" data-i="${i}">${label(s)}</button>`)}`);
    next.classList.add('hidden');
    reveal.textContent = '';
    drawStatus();
  };

  const finish = () => {
    const best = Math.max(score, prefs.get('guess-best', 0));
    prefs.set('guess-best', best);
    root.querySelector('.game').innerHTML = String(html`
      <div class="card center" style="padding:36px">
        <span class="eyebrow">Result</span>
        <div class="game-score">${score}<small>/ ${ROUNDS * 3}</small></div>
        <h1 style="font-size:var(--fs-xl)">${score} of ${ROUNDS * 3} points</h1>
        <p class="muted">${score >= 25 ? 'You know your maps by heart!' : score >= 15 ? 'Not bad, you’ve been playing.' : 'Plenty of maps left to discover.'} Your record is ${best}.</p>
        <div class="btn-row" style="justify-content:center">
          <a class="btn btn-primary" href="#/games/guess?mode=practice&r=${Date.now()}">Play again</a>
          <button class="btn" id="share" type="button">Copy result</button>
        </div>
      </div>`);
    copyButton(root, `Guess the map · PT-CTB: ${score}/${ROUNDS * 3} 🍎 ${location.href.split('#')[0]}#/games/guess?mode=practice`);
  };

  // A set without a cover can't be guessed: quietly swap it for the next one in the deck.
  img.addEventListener('error', () => {
    deck.splice(round % deck.length, 1);
    if (isCurrent()) start();
  });
  hint.addEventListener('click', () => { level = Math.min(level + 1, BLUR.length - 1); drawStatus(); });
  optionsEl.addEventListener('click', e => {
    const button = e.target.closest('[data-i]');
    if (!button || answered) return;
    answered = true;
    const chosen = options[Number(button.dataset.i)];
    const right = chosen === current;
    if (right) score += 3 - level;
    optionsEl.querySelectorAll('[data-i]').forEach(b => {
      b.disabled = true;
      if (options[Number(b.dataset.i)] === current) b.classList.add('right');
    });
    if (!right) button.classList.add('wrong');
    reveal.textContent = `${right ? 'Right!' : 'Unlucky, 1 miss. It was'} ${current[1]} - ${current[2]}, mapped by ${current[3]} · ${fmt.plural(current[4], 'Portuguese player')} on this set’s most played map.`;
    next.classList.remove('hidden');
    next.textContent = round + 1 >= ROUNDS ? 'See result' : 'Next →';
    drawStatus();
  });
  next.addEventListener('click', () => {
    round++;
    if (round >= ROUNDS) finish();
    else start();
  });
  start();
}

// ---- Higher or lower ------------------------------------------------------------------------------------------

const STATS = [
  { label: 'Converts pp', value: p => p.cv, format: v => `${fmt.num(v)} pp` },
  { label: 'Loved & Unranked pp', value: p => p.ul, format: v => `${fmt.num(v)} pp` },
  { label: 'official osu!catch pp', value: p => p.pp, format: v => `${fmt.num(v)} pp` },
  { label: '#1s in Portugal', value: p => p.firsts.c + p.firsts.u + p.firsts.r, format: v => fmt.num(v) },
  { label: 'osu!catch plays', value: p => p.plays, format: v => fmt.num(v) },
];

async function higherLower(root, isCurrent) {
  const list = await players();
  if (!isCurrent()) return;
  setTitle('Higher or lower?');
  let streak = 0, a = null, b = null, stat = null;

  const roundPair = () => {
    for (let tries = 0; tries < 50; tries++) {
      stat = pick(STATS);
      const pool = list.filter(p => stat.value(p) > 0);
      const first = a && stat.value(a) > 0 ? a : pick(pool);
      const second = pick(pool.filter(p => p !== first && stat.value(p) !== stat.value(first)));
      if (first && second) return [first, second];
    }
    return [list[0], list[1]];
  };

  const card = (p, shown) => html`<div class="duel-card">
    ${avatar(p.id, 'avatar-lg')}
    <b style="font-size:1.15rem">${p.name}</b>
    <span class="muted small">has</span>
    <span class="value">${shown ? stat.format(stat.value(p)) : '?'}</span>
    <span class="muted small">${stat.label}</span>
  </div>`;

  const draw = (revealed = false, result = null) => {
    root.innerHTML = String(html`
      <div class="game">
        <header class="page-head center">
          <span class="eyebrow"><a href="#/games">Games</a> · Higher or lower?</span>
          <h1>Who has more ${stat.label}?</h1>
        </header>
        <div class="scoreboard"><span>Streak <b>${streak}</b></span><span>Record <b>${prefs.get('hilo-best', 0)}</b></span></div>
        <div class="duel">
          ${card(a, true)}
          <div class="duel-vs">VS</div>
          ${card(b, revealed)}
        </div>
        <div class="btn-row" style="justify-content:center;margin-top:18px">
          ${revealed
            ? result
              ? html`<button class="btn btn-primary" id="continue" type="button">Continue →</button>`
              : html`<button class="btn btn-primary" id="restart" type="button">Start again</button><button class="btn" id="share" type="button">Copy result</button>`
            : html`<button class="btn btn-primary" data-guess="up" type="button">↑ Higher</button><button class="btn" data-guess="down" type="button">↓ Lower</button>`}
        </div>
        ${revealed ? html`<p class="game-result ${result ? 'right' : 'wrong'}">${result ? 'Right!' : html`<span>Unlucky, 1 miss. Your streak was <b>${streak}</b>. o7</span>`}</p>` : ''}
      </div>
    `);
    root.querySelectorAll('[data-guess]').forEach(button => button.addEventListener('click', () => {
      const higher = stat.value(b) > stat.value(a);
      const right = (button.dataset.guess === 'up') === higher;
      if (right) streak++;
      else prefs.set('hilo-best', Math.max(streak, prefs.get('hilo-best', 0)));
      if (right) prefs.set('hilo-best', Math.max(streak, prefs.get('hilo-best', 0)));
      draw(true, right);
      if (Math.round(stat.value(b)) === 727) wysi();
    }));
    root.querySelector('#continue')?.addEventListener('click', () => {
      a = b;
      [a, b] = roundPair();
      draw();
    });
    root.querySelector('#restart')?.addEventListener('click', () => {
      streak = 0;
      a = null;
      [a, b] = roundPair();
      draw();
    });
    if (revealed && !result) copyButton(root, `Higher or lower? · PT-CTB: a streak of ${streak} ⬆️⬇️`);
  };

  [a, b] = roundPair();
  draw();
}

export default async function games(root, { params, query, isCurrent }) {
  // #/games/guess is the daily map and ?mode=practice the ten rounds; old #/games/daily links still work.
  if (params.game === 'guess') return query.mode === 'practice' ? guessGame(root, isCurrent) : dailyGame(root, isCurrent);
  if (params.game === 'higher-lower') return higherLower(root, isCurrent);
  if (params.game === 'daily') return dailyGame(root, isCurrent);
  if (params.game === 'quiz') return quizGame(root, query, isCurrent);
  hub(root);
}
