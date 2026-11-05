// The Bounties tab's Bananas, in the browser: the post form, "Post a bounty on it" from the wanted list, and each Fund
// button. Both send a request the bot judges (bananas.js sendRequest); a refusal shows in the form's own line, Esc
// closes a form and gives focus back to what opened it. The player's requests are fetched once: what's waiting for the
// bot comes off the wallet shown, and posts the board doesn't show yet count against the rules.

import type { Ctx } from '../kernel/ctx.ts';
import { RULES, mapIdFrom, walletLine } from '../ui/bananas.ts';
import { closeOnEscape, myRequests, sendRequest } from '../client/bananas.ts';
import { pendingSpend } from '../ui/requests.ts';
import { scrollBehavior } from '../client/ui.ts';
import {
  chipOn, fundConfirm, fundNote, fundPick, fundSignIn, mapName, noWallet, postChecks, postFields, postHint, postSummary, walletOf,
  type Data, type PostChoice, type WalletRequest,
} from './bounties.ts';

export function mount(root: HTMLElement, ctx: Ctx, data: Data, isCurrent: () => boolean): void {
  const { t } = ctx;
  const me = ctx.me;
  const w = walletOf(ctx, data.economy);
  const open = data.board?.open ?? [];
  const maps = data.board?.maps ?? {};
  let requests: WalletRequest[] = [];
  let asked: WalletRequest[] = []; // the player's bounty.create requests the bot hasn't refused (postChecks)
  const free = () => (w ? w.b - pendingSpend(requests) : 0);

  // ---- Post: the fields are drawn once; the cost and the rules under them follow every change ----
  const form = root.querySelector<HTMLFormElement>('#post-form');
  const opener = root.querySelector<HTMLButtonElement>('#post-open');
  const choice: PostChoice = { goal: 'fc', mods: [], days: RULES.defaultDays };
  const field = (id: string) => form!.querySelector<HTMLInputElement>(id)!;
  const read = () => ({ map: mapIdFrom(field('#post-map').value), stake: Math.max(0, Math.round(Number(field('#post-stake').value) || 0)) });

  /** The first rule that fails at the minimum stake, next to the button that opens the form. */
  function drawHint() {
    const hint = root.querySelector('#post-hint');
    if (!hint || !w || me === null) return;
    root.querySelector('#post-wallet')!.innerHTML = String(walletLine(ctx, w, pendingSpend(requests)));
    hint.textContent = postHint(ctx, w, free(), open, me, asked);
  }
  function drawSummary() {
    if (!form || form.hidden || !form.querySelector('#post-sum') || !w || me === null) return;
    const { map, stake } = read();
    const checks = postChecks(ctx, w, free(), stake, open, me, asked);
    const failing = checks.find(c => !c[0]);
    form.querySelector<HTMLElement>('#post-snipe')!.hidden = choice.goal !== 'snipe';
    form.querySelector('#post-sum')!.innerHTML = String(postSummary(ctx, stake, free(), checks));
    form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = !(map && !failing);
    form.querySelector('#post-why')!.textContent = failing ? failing[2] : !map ? t('Add the map first.') : t('The bot checks it all again and answers within 15 minutes.');
  }
  const openPost = (mapText = '') => {
    form!.hidden = false;
    opener!.setAttribute('aria-expanded', 'true');
    form!.innerHTML = String(postFields(ctx, mapText, choice));
    drawSummary();
  };
  const closePost = () => {
    form!.hidden = true;
    opener!.setAttribute('aria-expanded', 'false');
    opener!.focus();
  };
  opener?.addEventListener('click', () => {
    if (form!.hidden) { openPost(); field('#post-map').focus(); } else closePost();
  });
  if (form) closeOnEscape(form, closePost);
  root.querySelectorAll<HTMLElement>('[data-post-map]').forEach(b => b.addEventListener('click', () => {
    root.querySelector('#post-bounty')!.scrollIntoView({ behavior: scrollBehavior() });
    if (!form) return;
    openPost(b.dataset.postMap);
    field('#post-stake').focus();
  }));
  form?.addEventListener('input', drawSummary);
  form?.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-goal], [data-mod], [data-days]');
    if (!b) return;
    const { goal, days, mod } = b.dataset;
    if (goal) choice.goal = goal as PostChoice['goal'];
    if (days) choice.days = Number(days);
    if (mod) choice.mods = choice.mods.includes(mod) ? choice.mods.filter(m => m !== mod) : [...choice.mods, mod];
    // Only the pressed state changes; the fields keep what was typed.
    for (const [attr, on] of Object.entries(chipOn(choice))) {
      form.querySelectorAll<HTMLElement>(`[data-${attr}]`).forEach(c => {
        c.classList.toggle('active', on(c.dataset[attr]!));
        c.setAttribute('aria-pressed', String(on(c.dataset[attr]!)));
      });
    }
    drawSummary();
  });
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const { map, stake } = read();
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    if (submit.disabled || !map || !w || me === null || postChecks(ctx, w, free(), stake, open, me, asked).some(c => !c[0])) return;
    // Disabled while it's on its way, so a second press can't send it twice.
    submit.disabled = true;
    const mods = RULES.mods.filter(m => choice.mods.includes(m)).join('') || null;
    const sent = await sendRequest('bounty.create', { map, goal: choice.goal, stake, mods, days: choice.days });
    if (sent.ok) {
      asked = [...asked, { type: 'bounty.create', status: 'pending', t: new Date().toISOString(), payload: { map } }];
      requests = [{ type: 'bounty.create', status: 'pending', payload: { map, stake }, t: new Date().toISOString() }, ...requests];
      closePost();
      drawHint();
      hideAsked();
    } else {
      submit.disabled = false;
      form.querySelector('#post-why')!.textContent = sent.message;
    }
  });
  /** "Post a bounty on it" goes from maps you've already asked to post on. */
  const hideAsked = () => {
    const mapsAsked = new Set(asked.map(r => String(r.payload.map)));
    root.querySelectorAll<HTMLElement>('[data-post-map]').forEach(b => { b.hidden = mapsAsked.has(b.dataset.postMap!); });
  };
  if (me !== null) {
    myRequests<WalletRequest>().then(list => {
      if (!list || !isCurrent()) return;
      requests = list;
      asked = list.filter(r => r.type === 'bounty.create' && r.status !== 'rejected');
      drawHint();
      drawSummary();
      hideAsked();
    });
  }

  // ---- Fund: an amount, then a confirmation with the wallet before and after ----
  root.querySelectorAll<HTMLButtonElement>('[data-fund]').forEach(button => {
    const box = button.nextElementSibling as HTMLElement;
    const id = Number(button.dataset.fund);
    const mapId = Number(button.closest<HTMLElement>('[data-map]')!.dataset.map);
    const name = mapName(mapId, maps[mapId]);
    const input = () => box.querySelector<HTMLInputElement>('input');
    const close = () => {
      box.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    };
    const update = () => {
      const amountInput = input();
      if (!amountInput) return 0;
      const amount = Math.round(Number(amountInput.value) || 0);
      box.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = !(amount >= RULES.minFund && amount <= free());
      box.querySelector('.fund-note')!.textContent = fundNote(ctx, amount, free());
      return amount;
    };
    const pick = (amount = Math.min(50, Math.max(RULES.minFund, free()))) => {
      box.innerHTML = String(fundPick(ctx, id, amount));
      update();
    };
    const back = () => {
      pick(Number(box.dataset.amount));
      input()!.focus();
    };
    box.addEventListener('input', update);
    box.addEventListener('submit', e => {
      e.preventDefault();
      const amount = update();
      if (amount < RULES.minFund || amount > free()) return;
      box.innerHTML = String(fundConfirm(ctx, amount, name, free()));
      box.dataset.amount = String(amount);
      box.querySelector<HTMLElement>('[data-confirm]')!.focus();
    });
    box.addEventListener('click', async e => {
      if ((e.target as Element).closest('[data-cancel]')) { back(); return; }
      const go = (e.target as Element).closest<HTMLButtonElement>('[data-confirm]');
      if (!go || go.disabled) return;
      go.disabled = true;
      const amount = Number(box.dataset.amount);
      const sent = await sendRequest('bounty.fund', { bountyId: id, amount });
      if (sent.ok) {
        requests = [{ type: 'bounty.fund', status: 'pending', payload: { bountyId: id, amount }, t: new Date().toISOString() }, ...requests];
        drawHint();
        close();
      } else {
        go.disabled = false;
        box.querySelector('.fund-error')!.textContent = sent.message;
      }
    });
    // Esc steps back: from the confirmation to the amount, then closes.
    closeOnEscape(box, () => { if (box.querySelector('[data-cancel]')) back(); else close(); });
    button.addEventListener('click', () => {
      const opening = box.hidden;
      box.hidden = !opening;
      button.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      if (me === null) { box.innerHTML = String(fundSignIn(ctx, data.signInHere)); return; }
      if (!w) { box.innerHTML = String(noWallet(ctx)); return; }
      pick();
      input()!.focus();
    });
  });
}
