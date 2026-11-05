// Easter eggs and seasonal touches, as assets/js/core/fun.js has them: typed triggers (outside text fields), toasts,
// the footer line and the logo's seasonal hat. Nothing here is needed to use the site; it's the community's in-jokes.

import { html, type Value } from '../kernel/html.ts';
import type { Text } from '../kernel/i18n.ts';
import { footerQuips, pick } from '../ui/lore.ts';
import type { Ctx } from '../kernel/ctx.ts';
import { text } from './i18n.ts';
import { track } from './track.ts';
import { go, reducedMotion } from './ui.ts';

let toastBox: HTMLElement | null = null;

/** A small dismissable message in the corner. `body` is text, or html`` markup. */
export function toast(body: Value, { ms = 6000 } = {}): void {
  toastBox ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = String(html`<div class="toast-body">${body}</div><button class="toast-close" type="button">${text().t('Dismiss')}</button>`);
  const close = () => el.remove();
  el.querySelector('.toast-close')!.addEventListener('click', close);
  toastBox.appendChild(el);
  if (ms) setTimeout(close, ms);
}

/** When you see it. */
export const wysi = (): void => flash('WYSI', 'flash-wysi');

function flash(content: string, cls: string): void {
  const el = document.createElement('div');
  el.className = `flash ${cls}`;
  el.textContent = content;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), reducedMotion() ? 900 : 1400);
}

function emoteWall(): void {
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

const RPS = ['rock', 'paper', 'scissors'] as const;
type Rps = typeof RPS[number];
const BEATS: Record<Rps, Rps> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const bacalhauOn = () => { try { return sessionStorage.getItem('ptctb:bacalhau') === '1'; } catch { return false; } };

function setBacalhau(on: boolean): void {
  try { sessionStorage.setItem('ptctb:bacalhau', on ? '1' : '0'); } catch { /* private mode */ }
  document.documentElement.classList.toggle('bacalhau', on);
}

/** Typed words that do something, checked against the end of what was typed, so they work mid-sentence too. */
function triggers({ t, th }: Text): { words: [string, () => void][]; rps: Set<string> } {
  /** The words in the page's language; typing those works too ("pedra" as well as "rock"). */
  const word: Record<Rps, string> = { rock: t('rock'), paper: t('paper'), scissors: t('scissors') };
  const rockPaperScissors = (you: Rps) => {
    const me = pick(RPS);
    const result = me === you ? t('A draw. Again?') : BEATS[you] === me ? t('You win. Enjoy it.') : t('I win. Skill issue.');
    toast(html`<b>${word[you]}</b> vs <b>${word[me]}</b>. ${result}`);
  };
  const words: [string, () => void][] = [
    ['727', () => wysi()],
    ['<rc', () => { go('/activity?view=plays'); toast(th('Yes, we know you’ve typed {rc} more often than “hello”.', { rc: html`<span class="kbd">&lt;rc</span>` })); }],
    ['aqui', () => toast(html`<b lang="pt-PT">Eu estou aqui</b>… <span lang="pt-PT">e tu?</span> <a href="/map/2311555">${t('Go and see the map')}</a>`)], // PT text (intentional)
    ['bacalhau', () => { const on = !bacalhauOn(); setBacalhau(on); toast(on ? html`<b>BACALHAU!</b> 🐟 ${t('The catcher only catches cod now.')}` : html`${t('Back to fruit.')} 🍎`); }],
    ...RPS.flatMap(rps => [...new Set([rps, word[rps]])].map((typed): [string, () => void] => [typed, () => rockPaperScissors(rps)])),
  ];
  return { words, rps: new Set([...RPS, ...Object.values(word)]) };
}

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** December gets a Santa hat on the logo; 10 June (Portugal Day) gets a bacalhau. */
export function season(date = new Date()): string | null {
  if (date.getMonth() === 11) return 'xmas';
  if (date.getMonth() === 5 && date.getDate() === 10) return 'ptday';
  return null;
}

export function startFun(ctx: Ctx): void {
  const { words, rps } = triggers(ctx);
  let typed = '';
  let konami = 0;
  document.addEventListener('keydown', e => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    konami = e.key === KONAMI[konami] ? konami + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) { konami = 0; track('egg', 'konami'); emoteWall(); return; }
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-12);
    const hit = words.find(([word]) => typed.endsWith(word));
    if (hit) { typed = ''; track('egg', rps.has(hit[0]) ? 'rock paper scissors' : hit[0]); hit[1](); }
  });
  if (bacalhauOn()) document.documentElement.classList.add('bacalhau');
  const s = season();
  if (s) document.documentElement.dataset.season = s;
  const quip = document.getElementById('quip');
  if (quip) quip.textContent = pick(footerQuips(ctx));
}
