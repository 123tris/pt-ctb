// Easter eggs and seasonal touches: typed triggers (outside text fields), toasts, the footer line and the logo's
// seasonal hat. Nothing here is needed to use the site; it's the community's in-jokes.

import { html } from './html.js';
import { FOOTER, pick } from './lore.js';
import { track } from './track.js';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let toastBox = null;

/** A small dismissable message in the corner. `body` is html`` markup. */
export function toast(body, { ms = 6000 } = {}) {
  toastBox ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = String(html`<div class="toast-body">${body}</div><button class="toast-close" type="button">Not now, Fie.</button>`);
  const close = () => el.remove();
  el.querySelector('.toast-close').addEventListener('click', close);
  toastBox.appendChild(el);
  if (ms) setTimeout(close, ms);
}

/** When you see it. */
export const wysi = () => flash('WYSI', 'flash-wysi');

function flash(text, cls) {
  const el = document.createElement('div');
  el.className = `flash ${cls}`;
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), reducedMotion() ? 900 : 1400);
}

function emoteWall() {
  if (reducedMotion()) { flash('🥀🗣️🐐🔥', 'flash-wall'); return; }
  const wall = document.createElement('div');
  wall.className = 'emote-wall';
  wall.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 48; i++) {
    const span = document.createElement('span');
    span.textContent = pick(['🥀', '🗣️', '🐐', '🔥']);
    span.style.left = `${Math.random() * 100}%`;
    span.style.animationDelay = `${Math.random() * 0.8}s`;
    span.style.fontSize = `${20 + Math.random() * 26}px`;
    wall.appendChild(span);
  }
  document.body.appendChild(wall);
  setTimeout(() => wall.remove(), 3200);
}

const RPS = ['rock', 'paper', 'scissors'];
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

function rockPaperScissors(you) {
  const me = pick(RPS);
  const result = me === you ? 'A draw. Again?' : BEATS[you] === me ? 'You win. Enjoy it.' : 'I win. Skill issue.';
  toast(html`<b>${you}</b> vs <b>${me}</b>. ${result}`);
}

const bacalhauOn = () => { try { return sessionStorage.getItem('ptctb:bacalhau') === '1'; } catch { return false; } };

function setBacalhau(on) {
  try { sessionStorage.setItem('ptctb:bacalhau', on ? '1' : '0'); } catch { /* private mode */ }
  document.documentElement.classList.toggle('bacalhau', on);
}

// Typed words that do something. Checked against the end of what was typed, so they work mid-sentence too.
const TRIGGERS = [
  ['727', () => wysi()],
  ['<rc', () => { location.hash = '#/activity?view=plays'; toast(html`Yes, we know you’ve typed <span class="kbd">&lt;rc</span> more often than “hello”.`); }],
  ['aqui', () => toast(html`<b lang="pt-PT">Eu estou aqui</b>… <span lang="pt-PT">e tu?</span> <a href="#/map/2311555">Go and see the map →</a>`)], // PT text (intentional)
  ['bacalhau', () => { const on = !bacalhauOn(); setBacalhau(on); toast(on ? html`<b>BACALHAU!</b> 🐟 The catcher only catches cod now.` : html`Back to fruit. 🍎`); }],
  ...RPS.map(word => [word, () => rockPaperScissors(word)]),
];
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

let typed = '';
let konami = 0;

function onKey(e) {
  const t = e.target;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  konami = e.key === KONAMI[konami] ? konami + 1 : e.key === KONAMI[0] ? 1 : 0;
  if (konami === KONAMI.length) { konami = 0; track('egg', 'konami'); emoteWall(); return; }
  if (e.key.length !== 1) return;
  typed = (typed + e.key.toLowerCase()).slice(-12);
  const hit = TRIGGERS.find(([word]) => typed.endsWith(word));
  if (hit) { typed = ''; track('egg', RPS.includes(hit[0]) ? 'rock paper scissors' : hit[0]); hit[1](); }
}

/** December gets a Santa hat on the logo; 10 June (Portugal Day) gets a bacalhau. */
export function season(date = new Date()) {
  if (date.getMonth() === 11) return 'xmas';
  if (date.getMonth() === 5 && date.getDate() === 10) return 'ptday';
  return null;
}

export function startFun() {
  document.addEventListener('keydown', onKey);
  if (bacalhauOn()) document.documentElement.classList.add('bacalhau');
  const s = season();
  if (s) document.documentElement.dataset.season = s;
  const quip = document.getElementById('quip');
  if (quip) quip.textContent = pick(FOOTER);
}
