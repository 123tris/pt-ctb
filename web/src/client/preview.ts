// Song previews: osu!'s 10-second clip of a map's song, played by any [data-preview] button (ui/maps.ts previewButton)
// through one audio element for the whole site. The clip goes straight from osu! (b.ppy.sh) to the browser, as on
// osu!'s own pages: the site keeps no audio and passes none through, and the CSP's media-src lets b.ppy.sh in
// (_headers). One clip plays at a time: a second tap stops it, another button takes over, and a new page stops it.

import type { Ctx } from '../kernel/ctx.ts';
import { previewUrl } from '../ui/maps.ts';

/** What osu! serves, whatever the address says. */
const TYPE = 'audio/ogg; codecs="vorbis"';

let audio: HTMLAudioElement | null = null;
/** The button whose clip is loading or playing. */
let owner: HTMLButtonElement | null = null;
let frame = 0;

/** The playing button's progress (--p, 0 to 1), each frame while the clip plays. A button the page took away stops it. */
function tick(): void {
  if (!audio || !owner) return;
  if (!owner.isConnected) return stopPreview();
  owner.style.setProperty('--p', audio.duration ? String(audio.currentTime / audio.duration) : '0');
  frame = requestAnimationFrame(tick);
}

/** The button back at rest. */
function release(): void {
  cancelAnimationFrame(frame);
  owner?.setAttribute('aria-pressed', 'false');
  owner?.classList.remove('loading');
  owner?.style.removeProperty('--p');
  owner = null;
}

/** Stops the clip that's playing, if one is. */
export function stopPreview(): void {
  if (audio && !audio.paused) audio.pause();
  release();
}

/** A button with nothing to play: off, saying why. */
function unavailable(button: HTMLButtonElement, label: string, why: string): void {
  button.disabled = true;
  button.textContent = label;
  button.title = why;
}

function player({ t }: Ctx): HTMLAudioElement {
  const a = new Audio();
  a.preload = 'none';
  a.volume = 0.5;
  a.addEventListener('playing', () => {
    owner?.classList.remove('loading');
    cancelAnimationFrame(frame);
    tick();
  });
  a.addEventListener('ended', release);
  a.addEventListener('error', () => {
    const failed = owner;
    release();
    if (!failed) return;
    // Offline or cut off: the next tap can try again. Anything else is osu!'s 404 for a set without a preview.
    if (!navigator.onLine || a.error?.code === MediaError.MEDIA_ERR_NETWORK) failed.title = t('Couldn’t reach osu!. Try again in a moment.');
    else unavailable(failed, t('No preview'), t('osu! has no preview of this song'));
  });
  return a;
}

function play(ctx: Ctx, button: HTMLButtonElement): void {
  const set = Number(button.dataset.preview);
  if (!(set > 0)) return;
  stopPreview();
  audio ??= player(ctx);
  // Safari before 18.4 can't play Ogg: say so on the button rather than fail silently.
  if (!audio.canPlayType(TYPE)) return unavailable(button, ctx.t('No preview'), ctx.t('This browser can’t play osu!’s previews'));
  owner = button;
  button.setAttribute('aria-pressed', 'true');
  button.classList.add('loading');
  audio.src = previewUrl(set);
  // A failed load is the error listener's; play() rejecting over it, or over a later tap's new clip, needs nothing more.
  audio.play().catch(() => {});
}

/** Wires every preview button, now and to come (one listener on the document), and stops the clip on a new page. */
export function startPreviews(ctx: Ctx): void {
  document.addEventListener('click', e => {
    const button = (e.target as Element).closest?.<HTMLButtonElement>('button[data-preview]');
    if (!button || button.disabled) return;
    if (button === owner) stopPreview();
    else play(ctx, button);
  });
  addEventListener('routechange', () => stopPreview());
}
