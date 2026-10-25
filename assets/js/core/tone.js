// TEMPORARY, development builds only: a switcher for trying colour tones across the whole site before picking one
// (site.css, "Tone trial"). Once a tone is chosen, fold its values into :root and delete this file, its CSS block and
// the initTone() call in app.js.

import { html } from './html.js';

/** [id, name, swatch, what changes]. The empty id is the current palette. */
const TONES = [
  ['', 'Rosa', '#ff6b89', 'Today’s palette: the accent and Loved are nearly the same pink'],
  ['lilac', 'Rosa + lilac', '#c9a0ff', 'Same accent; Loved & Unranked turns lilac so it stops reading as a link'],
  ['laranja', 'Laranja', '#ff9152', 'An orange accent on warm, less pink greys; Loved keeps osu!’s pink'],
  ['azulejo', 'Azulejo', '#5c9dff', 'A tile-blue accent on cooler greys; converts turn teal'],
];

const KEY = 'ptctb:tone';
const read = () => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const write = v => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

function apply(id) {
  if (id) document.documentElement.dataset.tone = id;
  else delete document.documentElement.dataset.tone;
}

export function initTone() {
  if (!document.documentElement.dataset.env && location.hostname !== 'localhost') return;
  let current = TONES.some(([id]) => id === read()) ? read() : '';
  apply(current);
  const box = document.createElement('div');
  box.className = 'tone-picker';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Colour tone (development site only)');
  const draw = () => {
    box.innerHTML = String(html`<span aria-hidden="true">Tone</span>${TONES.map(([id, name, swatch, tip]) => html`<button type="button" data-tone="${id}"
      aria-pressed="${String(id === current)}" title="${name}: ${tip}" aria-label="${name}"><i style="background:${swatch}"></i><span>${name}</span></button>`)}`);
  };
  box.addEventListener('click', e => {
    const button = e.target.closest('button[data-tone]');
    if (!button) return;
    current = button.dataset.tone;
    write(current);
    apply(current);
    draw();
  });
  draw();
  document.body.append(box);
}
