import { html } from '../core/html.js';
import { quiz, players } from '../core/data.js';
import { setTitle, avatar, coverUrl, prefs } from '../core/ui.js';
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
  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Games</span>
      <h1>For when your wrist needs a break</h1>
      <p>Two quick games made from the community’s data. Your records are saved in this browser.</p>
    </header>
    <div class="grid grid-2">
      <a class="card card-link" href="#/games/guess">
        <span class="eyebrow">Game 1</span>
        <h2>Guess the map</h2>
        <p class="muted">A blurred cover of a map the community has played appears. The sooner you get it, the more points you score. Ten rounds.</p>
        <p class="small faint" style="margin:0">${best !== null ? `Your record: ${best} of 30` : 'You haven’t played yet.'}</p>
      </a>
      <a class="card card-link" href="#/games/higher-lower">
        <span class="eyebrow">Game 2</span>
        <h2>Higher or lower?</h2>
        <p class="muted">Who has more pp, more #1s or more plays? Guess whether the next player is higher or lower and keep the streak alive.</p>
        <p class="small faint" style="margin:0">${streak !== null ? `Your best streak: ${streak}` : 'You haven’t played yet.'}</p>
      </a>
    </div>
  `);
}

// ---- Guess the map -----------------------------------------------------------------------------------------

const ROUNDS = 10;
const BLUR = [26, 14, 6]; // px per hint level; points = 3 - level

async function guessGame(root, isCurrent) {
  const { sets } = await quiz();
  if (!isCurrent()) return;
  setTitle('Guess the map');
  if (sets.length < 4) {
    root.innerHTML = String(html`<div class="empty">There aren’t enough maps for this game yet.</div>`);
    return;
  }

  // sets rows: [setId, artist, title, creator, playersHere]
  const deck = shuffle(sets);
  let round = 0, score = 0, level = 0, current = null, options = [], answered = false;

  root.innerHTML = String(html`
    <div class="game">
      <header class="page-head center">
        <span class="eyebrow"><a href="#/games">Games</a> · Guess the map</span>
        <h1>Which map is this?</h1>
      </header>
      <div class="scoreboard"><span>Round <b><span id="round">1</span><small>/${ROUNDS}</small></b></span><span>Points <b id="score">0</b></span><span>Worth <b id="worth">3</b></span></div>
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
          <a class="btn btn-primary" href="#/games/guess?r=${Date.now()}">Play again</a>
          <button class="btn" id="share" type="button">Copy result</button>
        </div>
      </div>`);
    copyButton(root, `Guess the map · PT-CTB: ${score}/${ROUNDS * 3} 🍎 ${location.href.split('#')[0]}#/games/guess`);
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
    reveal.textContent = `${right ? 'Right!' : 'It was'} ${current[1]} - ${current[2]}, mapped by ${current[3]} · ${fmt.plural(current[4], 'Portuguese player')} on this set’s most played map.`;
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
        ${revealed ? html`<p class="game-result ${result ? 'right' : 'wrong'}">${result ? 'Right!' : html`<span>Wrong! Your streak was <b>${streak}</b>.</span>`}</p>` : ''}
      </div>
    `);
    root.querySelectorAll('[data-guess]').forEach(button => button.addEventListener('click', () => {
      const higher = stat.value(b) > stat.value(a);
      const right = (button.dataset.guess === 'up') === higher;
      if (right) streak++;
      else prefs.set('hilo-best', Math.max(streak, prefs.get('hilo-best', 0)));
      if (right) prefs.set('hilo-best', Math.max(streak, prefs.get('hilo-best', 0)));
      draw(true, right);
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

export default async function games(root, { params, isCurrent }) {
  if (params.game === 'guess') return guessGame(root, isCurrent);
  if (params.game === 'higher-lower') return higherLower(root, isCurrent);
  hub(root);
}
