// /top10/vote: your Top 10 ballot (§3.1–3.4), mobile first. Your list on top (5 to 10 players, ties as "same spot as
// above", ↑/↓ and drag to reorder), the optional extras folded away (honourable mentions, ones to watch, intro and
// closing message), and the picker under it: every PT player, the most active this year first, with filters and
// search; your own card greyed out. ⓘ opens a player's dossier in a drawer. Drafts save themselves.
//
// Once the ballot is in, the page turns to write-ups (§3.4): one player at a time, with prompt chips, cite a score
// and a live word counter that mirrors the server's (ui/top10.ts wordMeter). Everything here is pure; the browser half
// is top10-ballot.mount.ts, which keeps the editor's state and draws these parts again as it changes.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { avatar, rowOf } from '../ui/players.ts';
import { signInButton } from '../ui/bananas.ts';
import { chipGroup } from '../ui/page.ts';
import {
  ballotProblems, flagList, flagsOf, lisbon, modWarning, phaseName, publicNote, rules, scoreCard, spotsOf, toSec, top10Tabs, troubleNote,
  wordMeter, wordsOf, MAX_BODY, MAX_EXTRAS, MAX_NOTE, MAX_PICKS, MIN_PICKS, PEAK_WORDS,
  KINDS, kindName, type BallotStatus, type Card, type Kind, type LogLine, type OwnBallot, type Phase, type Row, type Season, type Trouble,
} from '../ui/top10.ts';
import { candidateCard, type Candidate } from '../ui/top10-players.ts';
import type { History } from './player.ts';

export interface Data {
  /** Which ballot (§13.11): the year's, or all time's (no ones to watch, career cards, cites from any year); both list the candidates by official pp. */
  kind: Kind;
  core: CorePack;
  history: History | null;
  season: Season;
  phase: Phase;
  /** Why the endpoints didn't answer (503: not on this copy), or null. */
  trouble: Trouble;
  /** Signed in and a PT player, as GET /api/top10 says (true when it can't be asked). */
  eligible: boolean;
  /** Why not, as the server's code (not_pt, data_unavailable) and words. */
  code: string | null;
  reason: string | null;
  /** The mod actions on your ballot, write-ups and showcase entries (GET /ballot `log`). */
  log: LogLine[];
  /** Your ballot as the server has it, or null (none yet, signed out, or not reachable). */
  ballot: OwnBallot | null;
  candidates: Candidate[];
  signInHere: boolean;
}

export type Target = 'list' | 'mentions' | 'watch';

/** The editor's state: what the page shows and what a save sends. */
export interface Editor {
  rows: Row[];
  mentions: number[];
  watch: number[];
  intro: string;
  outro: string;
  writeups: Record<string, { body: string; cites: string[] }>;
  /** The server's flags and mod status on each write-up, as of the last load or save. */
  server: Record<string, { flags: string[]; mod?: string; mod_reason?: string | null }>;
  /** The cited plays' cards, by ref: the server's (GET /ballot `scores`), and the ones picked from the cite list. */
  scores: Record<string, Card>;
  status: BallotStatus;
  voidReason: string | null;
  target: Target;
  /** The picker's filter: all-time adds legends, and starts on everyone. */
  filter: 'active' | 'all' | 'legends';
  q: string;
  /** 'list' builds the list; 'write' is the write-ups, one player at a time (`writing` is the index). */
  mode: 'list' | 'write';
  writing: number;
  /** "Just submitted": the write-ups' welcome line. */
  fresh: boolean;
}

/** What the page lets you do: edit and save, edit kept in this browser only, or read. */
export type Access = 'edit' | 'local' | 'read' | 'signed-out' | 'ineligible';

export function accessOf(ctx: Ctx, d: Data): Access {
  if (ctx.me === null) return 'signed-out';
  if (!d.eligible) return 'ineligible';
  if (d.ballot?.status === 'void') return 'read';
  if (d.trouble === 'off' || d.trouble === 'offline' || d.phase === 'before') return 'local';
  return d.phase === 'open' && !d.trouble ? 'edit' : 'read';
}

export function editorOf(b: OwnBallot | null, query: Record<string, string | undefined>, kind: Kind = 'year'): Editor {
  const sorted = [...(b?.picks ?? [])].sort((x, y) => x.spot - y.spot);
  const writeups: Editor['writeups'] = {};
  const server: Editor['server'] = {};
  for (const [id, w] of Object.entries(b?.writeups ?? {})) {
    writeups[id] = { body: w.body ?? '', cites: w.cites ?? [] };
    server[id] = { flags: flagList(w.flags), mod: w.mod, mod_reason: w.mod_reason };
  }
  return {
    rows: sorted.map((p, i) => ({ id: p.id, tie: i > 0 && p.spot === sorted[i - 1].spot })),
    mentions: b?.mentions ?? [], watch: kind === 'alltime' ? [] : b?.watch ?? [], intro: b?.intro ?? '', outro: b?.outro ?? '', writeups, server,
    scores: { ...(b?.scores ?? {}) },
    status: b?.status ?? 'draft', voidReason: b?.void_reason ?? null,
    target: 'list', filter: kind === 'alltime' ? 'all' : 'active', q: '',
    mode: query.write !== undefined && b?.picks?.length ? 'write' : 'list', writing: 0, fresh: false,
  };
}

/** Who the write-ups cover, in order: the list, then the mentions and ones to watch. */
export const writeOrder = (e: Editor): { id: number; kind: Target }[] => [
  ...e.rows.map(r => ({ id: r.id, kind: 'list' as const })),
  ...e.mentions.map(id => ({ id, kind: 'mentions' as const })),
  ...e.watch.map(id => ({ id, kind: 'watch' as const })),
];

/** Where a player is on the ballot: "#3", "=6", "HM" (an honourable mention), "W" (one to watch), or ''. */
export function placeOf(e: Editor, id: number): string {
  const i = e.rows.findIndex(r => r.id === id);
  if (i >= 0) {
    const spots = spotsOf(e.rows);
    return `${spots.filter(s => s === spots[i]).length > 1 ? '=' : '#'}${spots[i]}`;
  }
  if (e.mentions.includes(id)) return 'HM';
  if (e.watch.includes(id)) return 'W';
  return '';
}

const nameOf = (core: CorePack, id: number) => { const r = rowOf(core.players, id); return r < 0 ? `#${id}` : core.players.name.at(r); };
const face = (ctx: Ctx, core: CorePack, id: number, cls = '') => { const r = rowOf(core.players, id); return r < 0 ? '' : avatar(ctx, core.players, r, cls); };

/** Your list: ten slots, the filled ones with their controls. */
export function listSection(ctx: Ctx, d: Data, e: Editor, access: Access): Safe {
  const { t, fmt } = ctx;
  const spots = spotsOf(e.rows);
  const can = access === 'edit' || access === 'local';
  // The filled spots, then the next one, then one line for the rest (ten empty boxes would fill a phone's screen).
  const n = e.rows.length;
  const after = n + 1 < MIN_PICKS ? t('Spots {from}–{to} to go, {more}–10 optional', { from: n + 2, to: MIN_PICKS, more: MIN_PICKS + 1 })
    : n + 2 < MAX_PICKS ? t('Spots {from}–10 optional', { from: Math.max(n + 2, MIN_PICKS + 1) })
      : n + 2 === MAX_PICKS ? t('Spot 10 optional') : '';
  const slots = Array.from({ length: Math.min(MAX_PICKS, n + 1) }, (_, i) => {
    const r = e.rows[i];
    if (!r) {
      return html`<li class="t10-slot t10-slot-empty t10-slot-next ${i >= MIN_PICKS ? 't10-slot-opt' : ''}">
        <span class="t10-spot">${i + 1}</span><span class="t10-slot-hint">${can ? t('Tap a player below to add them here') : i >= MIN_PICKS ? t('optional') : ''}</span></li>`;
    }
    const name = nameOf(d.core, r.id);
    const tied = spots.filter(s => s === spots[i]).length > 1;
    return html`<li class="t10-slot ${r.tie ? 't10-slot-tie' : ''}" data-i="${i}" ${can ? raw('draggable="true"') : ''}>
      <span class="t10-spot" aria-label="${t('Spot {n}', { n: spots[i] })}">${tied ? '=' : ''}${spots[i]}</span>
      ${can ? html`<span class="t10-grip" aria-hidden="true">⋮⋮</span>` : ''}
      <span class="t10-slot-who">${face(ctx, d.core, r.id, 'avatar-sm')}<span class="t10-slot-name">${name}</span></span>
      <span class="t10-slot-tools">
        ${can && i > 0 ? html`<button class="t10-tie" type="button" data-tie="${i}" aria-pressed="${String(r.tie)}" title="${t('Same spot as above')}"><span aria-hidden="true">=</span><span class="t10-tie-text">${t('same spot')}</span><span class="sr-only"> ${t('as {name}', { name: nameOf(d.core, e.rows[i - 1].id) })}</span></button>` : ''}
        ${can ? html`<button class="t10-icon" type="button" data-up="${i}" ${i === 0 ? raw('disabled') : ''} aria-label="${t('Move {name} up', { name })}">↑</button>
          <button class="t10-icon" type="button" data-down="${i}" ${i === e.rows.length - 1 ? raw('disabled') : ''} aria-label="${t('Move {name} down', { name })}">↓</button>` : ''}
        <button class="t10-icon" type="button" data-info="${r.id}" aria-label="${t('{name}’s year', { name })}">ⓘ</button>
        ${can ? html`<button class="t10-icon t10-x" type="button" data-remove="${r.id}" aria-label="${t('Take {name} off your list', { name })}">✕</button>` : ''}
      </span>
    </li>`;
  });
  return html`<section class="t10-list-wrap" aria-labelledby="t10-list-h">
    <div class="t10-list-head"><h2 id="t10-list-h">${t('Your list')}</h2>
      <span class="t10-count ${n >= MIN_PICKS ? 't10-count-ok' : ''}">${t('{n} of {max}', { n: fmt.num(n), max: fmt.num(MAX_PICKS) })}${n < MIN_PICKS ? html` · ${t('at least {n} to submit', { n: MIN_PICKS })}` : ''}</span></div>
    <ol class="t10-list" data-list>${slots}</ol>
    ${can && after ? html`<p class="small faint t10-after">${after}</p>` : ''}
  </section>`;
}

/** The honourable mentions and ones to watch, as chips you can take off. */
function extraChips(ctx: Ctx, d: Data, ids: readonly number[], kind: Target, can: boolean): Safe {
  const { t } = ctx;
  return ids.length ? html`<ul class="t10-extra-list">${ids.map(id => html`<li>${face(ctx, d.core, id, 'avatar-sm')} <span>${nameOf(d.core, id)}</span>
      ${can ? html`<button class="t10-icon t10-x" type="button" data-remove-${raw(kind)}="${id}" aria-label="${t('Take {name} off', { name: nameOf(d.core, id) })}">✕</button>` : ''}</li>`)}</ul>`
    : html`<p class="small faint m-0">${can ? t('None yet: pick “{target}” above the players, then tap them.', { target: kind === 'mentions' ? t('Honourable mentions') : t('Ones to watch') }) : t('None.')}</p>`;
}

/** The optional extras, folded away. */
export function extrasSection(ctx: Ctx, d: Data, e: Editor, access: Access, open: boolean): Safe {
  const { t, fmt } = ctx;
  const can = access === 'edit' || access === 'local';
  const filled = e.mentions.length + e.watch.length + (e.intro ? 1 : 0) + (e.outro ? 1 : 0);
  return html`<details class="t10-extras" data-extras ${open ? raw('open') : ''}>
    <summary>${t('Extras, all optional')}${filled ? html` <span class="t10-pill">${fmt.num(filled)}</span>` : ''}<span class="small faint t10-extras-sub">${d.kind === 'alltime' ? t('Honourable mentions, an intro and a closing message') : t('Honourable mentions, ones to watch, an intro and a closing message')}</span></summary>
    <div class="t10-extras-body">
      <div><h3 class="t10-h3">${t('Honourable mentions')} <span class="faint small">${t('up to {n}', { n: MAX_EXTRAS })}</span></h3><div data-mentions>${extraChips(ctx, d, e.mentions, 'mentions', can)}</div></div>
      ${d.kind === 'alltime' ? '' : html`<div><h3 class="t10-h3">${t('Ones to watch')} <span class="faint small">${t('up to {n}: who you think is next', { n: MAX_EXTRAS })}</span></h3><div data-watch>${extraChips(ctx, d, e.watch, 'watch', can)}</div></div>`}
      <label class="t10-field"><span>${t('Intro')}</span>
        <textarea class="input t10-note" data-note="intro" maxlength="${MAX_NOTE}" rows="3" ${can ? '' : raw('readonly')} placeholder="${t('How you made your list, what you weighed…')}">${e.intro}</textarea></label>
      <label class="t10-field"><span>${t('Closing message')}</span>
        <textarea class="input t10-note" data-note="outro" maxlength="${MAX_NOTE}" rows="3" ${can ? '' : raw('readonly')} placeholder="${t('Anything else: shout-outs, GGs, next year…')}">${e.outro}</textarea></label>
    </div>
  </details>`;
}

/** The candidates the filters let through. */
export function shownCandidates(d: Data, e: Editor): Candidate[] {
  const q = e.q.trim().toLocaleLowerCase();
  if (q) return d.candidates.filter(c => c.name.toLocaleLowerCase().includes(q));
  // All time: everyone (the default), the active (not inactive now) or the legends; a year: active this year or everyone.
  const keep = (c: Candidate) => (e.filter === 'all' ? true : e.filter === 'legends' ? c.legend : d.kind === 'alltime' ? !c.inactive : c.active);
  return d.candidates.filter(c => keep(c) || placeOf(e, c.id));
}

export function pickerCards(ctx: Ctx, d: Data, e: Editor): Safe {
  const { t } = ctx;
  const list = shownCandidates(d, e);
  return list.length ? html`${list.map(c => candidateCard(ctx, d.core, c, d.season.year, { me: ctx.me, placed: placeOf(e, c.id), alltime: d.kind === 'alltime' }))}`
    : html`<li class="t10-none">${e.q ? t('No PT player matches “{q}”.', { q: e.q }) : t('Nobody here yet.')}</li>`;
}

/** The picker: what a tap adds to, the filters, and the cards. */
export function pickerSection(ctx: Ctx, d: Data, e: Editor, access: Access): Safe {
  const { t } = ctx;
  const can = access === 'edit' || access === 'local';
  return html`<section class="t10-picker" aria-labelledby="t10-pick-h">
    <h2 id="t10-pick-h">${t('Pick players')}</h2>
    <p class="small muted m-0">${d.kind === 'alltime'
      ? t('By official pp now, highest first, legends included. ⓘ shows a player’s career.')
      : t('By official pp now, highest first. ⓘ shows a player’s year.')}</p>
    ${can ? chipGroup(t('Tapping adds to'), 'target', [['list', t('Your list')], ['mentions', t('Honourable mentions')],
      ...(d.kind === 'alltime' ? [] : [['watch', t('Ones to watch')] as [string, string]])], e.target) : ''}
    <div class="t10-filters">
      ${d.kind === 'alltime' ? chipGroup(t('Show'), 'filter', [['all', t('Everyone')], ['active', t('Active')], ['legends', t('Legends')]], e.filter)
        : chipGroup(t('Show'), 'filter', [['active', t('Active this year')], ['all', t('Everyone')]], e.filter)}
      <input class="input t10-search" type="search" data-q value="${e.q}" placeholder="${t('Search players')}" aria-label="${t('Search players')}" autocomplete="off">
    </div>
    <ul class="t10-cards" data-cards>${pickerCards(ctx, d, e)}</ul>
  </section>`;
}

/** The write-up box's prompt before a hint is picked. */
export const placeholderOf = ({ t }: Ctx, kind: Kind, name: string): string => (kind === 'alltime'
  ? t('Why is {name} one of PT’s greatest? They’ll read this as soon as you submit.', { name })
  : t('What made {name}’s year? They’ll read this as soon as you submit.', { name }));

/** The two ballots' switch (§13.11): the year's and all time's, each its own page. */
export const kindSwitch = (ctx: Ctx, kind: Kind, year: number): Safe => html`<nav class="chips t10-kinds" aria-label="${ctx.t('Which ballot')}">
  ${KINDS.map(k => html`<a class="chip ${k === kind ? 'active' : ''}" href="${k === 'alltime' ? '/top10/vote/alltime' : '/top10/vote'}" ${k === kind ? raw('aria-current="page"') : ''}>${kindName(ctx, k, year)}</a>`)}</nav>`;

/** Hints for a write-up (§3.4): they don't insert text, they only change the box's prompt. */
export const PROMPTS = (ctx: Ctx, kind: Kind = 'year'): [string, string][] => {
  const { t } = ctx;
  if (kind === 'alltime') {
    return [
      [t('A play that defined them'), t('Which play sums up their career, and why that one?')],
      [t('What they meant to PT catch'), t('What did they bring to the community, and who did they inspire?')],
      [t('Their era'), t('When were they at their best, and who were they up against?')],
    ];
  }
  return [
    [t('A score you won’t forget'), t('Which score of theirs stuck with you this year, and why?')],
    [t('How they changed this year'), t('What’s different about how they play now, compared to January?')],
    [t('A tournament or multi moment'), t('A match, a lobby or a tournament where they stood out.')],
    [t('What you hope to see next year'), t('What do you want to see from them in the year to come?')],
  ];
};

/** Cards for a player's scores you can cite: their showcase entries and plays of the year. */
export interface CiteChoice {
  ref: string;
  card: Card | null;
  label: string;
  /** Set before its map was ranked (the pack's pre-rank plays): 0pp. */
  pre?: boolean;
}

/** The write-ups, one player at a time. `choices` are the current player's citable scores, once loaded (null before). */
export function writerSection(ctx: Ctx, d: Data, e: Editor, access: Access, { prompt = '', choices = null as CiteChoice[] | null, citeOpen = false } = {}): Safe {
  const { t, fmt } = ctx;
  const order = writeOrder(e);
  if (!order.length) return html`<p class="empty">${t('Add players to your list first.')}</p>`;
  const i = Math.min(e.writing, order.length - 1);
  const { id, kind } = order[i];
  const name = nameOf(d.core, id);
  const w = e.writeups[id] ?? { body: '', cites: [] };
  const can = access === 'edit' || access === 'local';
  const others = Object.entries(e.writeups).filter(([k]) => k !== String(id)).map(([, x]) => x.body);
  const flags = [...new Set([...flagsOf(w.body, others), ...(e.server[id]?.flags ?? [])])];
  const struck = e.server[id]?.mod === 'struck';
  const ranked = e.rows.filter(r => (e.writeups[r.id]?.body ?? '').trim());
  const full = e.rows.filter(r => wordsOf(e.writeups[r.id]?.body ?? '').length >= PEAK_WORDS);
  const spot = kind === 'list' ? placeOf(e, id) : kind === 'mentions' ? t('Honourable mention') : t('One to watch');
  const cited = w.cites.map(ref => ({ ref, card: e.scores[ref] ?? choices?.find(c => c.ref === ref)?.card ?? null }));

  return html`<section class="t10-writer" aria-labelledby="t10-w-h" data-writer>
    ${e.fresh ? html`<div class="t10-done"><p class="t10-done-big">${d.kind === 'alltime' ? t('Your top 10 of all time is in') : t('Your top 10 is in')}</p><p class="m-0">${t('Now the good part: tell them why. One player at a time, and every word is optional.')}</p></div>` : ''}
    <div class="t10-writer-top">
      <span class="t10-count">${t('{n} of {max} written', { n: fmt.num(ranked.length), max: fmt.num(e.rows.length) })}</span>
      <span class="small faint">${full.length === e.rows.length && e.rows.length ? t('Everyone at 40+ words: +30 🍌') : t('+30 🍌 when everyone on your list has 40+ words')}</span>
    </div>
    <ol class="t10-steps" aria-label="${t('Players to write about')}">${order.map((o, j) => html`<li><button type="button" class="t10-step ${j === i ? 't10-step-on' : ''} ${(e.writeups[o.id]?.body ?? '').trim() ? 't10-step-done' : ''}"
      data-step="${j}" ${j === i ? raw('aria-current="step"') : ''} title="${nameOf(d.core, o.id)}">${face(ctx, d.core, o.id, 'avatar-sm')}<span class="sr-only">${nameOf(d.core, o.id)}</span></button></li>`)}</ol>

    <div class="t10-writer-who">
      ${face(ctx, d.core, id, 'avatar-md')}
      <div><span class="eyebrow m-0">${spot}</span><h2 id="t10-w-h" class="m-0">${name}</h2></div>
      <button class="t10-icon" type="button" data-info="${id}" aria-label="${t('{name}’s year', { name })}">ⓘ</button>
    </div>
    ${struck ? html`<p class="notice t10-struck">${t('A mod removed this write-up: {reason}. You can rewrite it until voting closes.', { reason: e.server[id]?.mod_reason || t('no reason given') })}</p>` : ''}

    <div class="chips t10-prompts" role="group" aria-label="${t('Ideas')}">${PROMPTS(ctx, d.kind).map(([label, hint]) =>
      html`<button class="chip ${prompt === hint ? 'active' : ''}" type="button" data-prompt="${hint}" aria-pressed="${String(prompt === hint)}">${label}</button>`)}</div>
    <label class="sr-only" for="t10-body">${t('Your write-up about {name}', { name })}</label>
    <textarea id="t10-body" class="input t10-body" data-body="${id}" rows="7" maxlength="${MAX_BODY}" ${can ? '' : raw('readonly')}
      placeholder="${prompt || placeholderOf(ctx, d.kind, name)}">${w.body}</textarea>
    <div data-meter>${wordMeter(ctx, wordsOf(w.body).length, flags, { pays: kind === 'list' })}</div>

    <div class="t10-cites" data-cites>${cited.map(c => scoreCard(ctx, c.card, c.ref, can ? html`<button class="t10-icon t10-x" type="button" data-uncite="${c.ref}" aria-label="${t('Remove this score')}">✕</button>` : ''))}</div>
    ${can ? html`<button class="btn btn-small" type="button" data-cite aria-expanded="${String(citeOpen)}">${t('Cite a score')}</button>` : ''}
    ${citeOpen ? html`<div class="t10-cite-pick" data-cite-pick>${choices === null ? html`<p class="small muted">${t('Loading…')}</p>`
      : choices.length ? html`<p class="small muted m-0">${d.kind === 'alltime' ? t('Their legendary plays and career best plays, any year. A cited score shows as a card under your write-up.')
        : t('Their showcased scores and plays of {year}. A cited score shows as a card under your write-up.', { year: d.season.year })}</p>
        <ul class="t10-cite-list">${choices.map(c => html`<li><label><input type="checkbox" data-cite-ref="${c.ref}" ${w.cites.includes(c.ref) ? raw('checked') : ''}> ${scoreCard(ctx, c.card, c.ref, c.label ? html`<span class="t10-pill">${c.label}</span>` : '')}</label></li>`)}</ul>`
        : html`<p class="small muted">${t('No scores of theirs to cite yet.')}</p>`}</div>` : ''}

    <div class="t10-writer-nav">
      <button class="btn" type="button" data-prev ${i === 0 ? raw('disabled') : ''}>← ${t('Previous')}</button>
      ${i < order.length - 1 ? html`<button class="btn btn-primary" type="button" data-next>${(w.body ?? '').trim() ? t('Next player') : t('Skip')} →</button>`
        : html`<button class="btn btn-primary" type="button" data-finish>${t('Done')}</button>`}
    </div>
    <p class="small faint">${t('Write-ups pay 1 🍌 per word, up to 40, for players on your list, after mods review them once voting closes.')}</p>
  </section>`;
}

/** The status line: draft or in, and the last save. */
export function statusLine(ctx: Ctx, e: Editor, access: Access, save: string): Safe {
  const { t } = ctx;
  const chip = e.status === 'submitted' ? html`<span class="t10-state t10-state-in">${t('Submitted · public')}</span>`
    : e.status === 'void' ? html`<span class="t10-state t10-state-void">${t('Voided')}</span>`
      : html`<span class="t10-state">${t('Draft · only you can see it')}</span>`;
  return html`${chip} <span class="small faint" data-save aria-live="polite">${access === 'local' ? t('Kept in this browser') : save}</span>`;
}

/** The bar at the bottom: the count, problems and Submit (or Withdraw once in). */
export function actionBar(ctx: Ctx, d: Data, e: Editor, access: Access): Safe {
  const { t } = ctx;
  if (access !== 'edit' && access !== 'local') return html``;
  const problems = ballotProblems(ctx, e.rows, e.mentions, e.watch, ctx.me);
  const isIn = e.status === 'submitted';
  const writeLabel = isIn ? t('Write about them') : t('Write-ups');
  return html`<div class="t10-bar-in">
    <span class="small ${problems.length ? 'muted' : ''}" data-problems>${problems[0] ?? (isIn ? t('Your edits go live as they save.') : t('Ready to submit.'))}</span>
    <span class="btn-row">
      ${e.mode === 'list' && e.rows.length ? html`<button class="btn btn-small" type="button" data-write>${writeLabel}</button>` : ''}
      ${e.mode === 'write' ? html`<button class="btn btn-small" type="button" data-back>${t('Your list')}</button>` : ''}
      ${isIn ? html`<button class="btn btn-small" type="button" data-withdraw ${access !== 'edit' ? raw('disabled') : ''}>${t('Withdraw')}</button>`
        : html`<button class="btn btn-small btn-primary" type="button" data-submit ${problems.length || access !== 'edit' ? raw('disabled') : ''}>${t('Submit')}</button>`}
    </span>
  </div>`;
}

/** What a mod did, in words: "Struck your write-up about Hiroto-: <reason>". */
export function logLine(ctx: Ctx, core: CorePack, l: LogLine): string {
  const { t } = ctx;
  // An all-time target has "alltime:" after its type ("writeup:alltime:<voter>:<subject>", §13.11).
  const parts = l.target.split(':');
  const alltime = l.kind === 'alltime' || parts.includes('alltime');
  const [kind, a, b] = parts.filter(p => p !== 'alltime');
  const what = kind === 'writeup' || (/^\d+$/.test(kind) && a !== undefined)
    ? (alltime ? t('your all-time write-up about {name}', { name: nameOf(core, Number(kind === 'writeup' ? b : a)) })
      : t('your write-up about {name}', { name: nameOf(core, Number(kind === 'writeup' ? b : a)) }))
    : kind === 'play' ? t('your showcase entry') : alltime ? t('your all-time ballot') : t('your ballot');
  const did = ({
    strike: t('Struck {what}', { what }), restore: t('Restored {what}', { what }), 'hide-play': t('Hid {what}', { what }),
    'show-play': t('Showed {what} again', { what }), void: t('Voided {what}', { what }), unvoid: t('Restored {what}', { what }),
  } as Record<string, string>)[l.action] ?? `${l.action} ${what}`;
  return l.reason ? `${did}: ${l.reason}` : did;
}

/** The mods' actions on your things (§8: every action is shown to the player it's about). */
function modLog(ctx: Ctx, d: Data): Safe | '' {
  const { t, fmt } = ctx;
  if (!d.log.length) return '';
  return html`<details class="t10-modlog notice"><summary>${t('What the mods did on your ballot ({n})', { n: fmt.num(d.log.length) })}</summary>
    <ul>${d.log.map(l => html`<li>${logLine(ctx, d.core, l)}${toSec(l.at) ? html` <span class="small faint">${fmt.dateTime(toSec(l.at))}</span>` : ''}</li>`)}</ul></details>`;
}

export function render(ctx: Ctx, d: Data, e: Editor): Safe {
  const { t } = ctx;
  const access = accessOf(ctx, d);
  const year = d.season.year;
  const head = html`${top10Tabs(ctx, 'vote', year)}
    <header class="page-head t10-head"><h1>${d.kind === 'alltime' ? t('Your top 10 of all time') : t('Your top 10 of {year}', { year })}</h1>
      <p class="t10-status" data-status>${access === 'signed-out' || access === 'ineligible' ? phaseName(ctx, d.phase) : statusLine(ctx, e, access, '')}</p></header>
    ${kindSwitch(ctx, d.kind, year)}`;
  const rulesBox = html`<details class="t10-rules-box"><summary>${t('The rules')}</summary>${rules(ctx, d.season, d.kind)}</details>`;
  if (access === 'signed-out') {
    return html`${head}${troubleNote(ctx, d.trouble === 'signin' ? null : d.trouble)}
      <div class="empty"><p>${t('Only PT players can vote: sign in with osu! to make your list.')}</p>${signInButton(ctx, d.signInHere)}</div>${rulesBox}`;
  }
  if (access === 'ineligible') return html`${head}<div class="empty"><p>${d.code === 'data_unavailable' ? t('The site’s player data couldn’t be read just now. Try again in a minute.') : t('Only PT players on the site can vote, and your osu! account isn’t in its list of Portuguese players.')}</p></div>${rulesBox}`;

  const phaseNote = d.trouble ? troubleNote(ctx, d.trouble)
    : d.phase === 'before' ? html`<p class="notice">${t('Voting opens {when}. You can start your list now: it stays in this browser until then.', { when: lisbon(ctx, toSec(d.season.opens)) })}</p>`
      : d.phase === 'closed' || d.phase === 'revealed' ? html`<p class="notice">${t('Voting closed {when}. This is your ballot as it was counted.', { when: lisbon(ctx, toSec(d.season.closes)) })}</p>` : '';
  const voidNote = e.status === 'void' ? html`<p class="notice t10-struck">${t('A mod voided this ballot: {reason}', { reason: e.voidReason || t('no reason given') })}</p>` : '';
  const body = e.mode === 'write' ? writerSection(ctx, d, e, access)
    : html`${listSection(ctx, d, e, access)}${extrasSection(ctx, d, e, access, false)}${access === 'read' ? '' : pickerSection(ctx, d, e, access)}`;
  return html`${head}${phaseNote}${voidNote}${modLog(ctx, d)}
    <div data-main>${body}</div>
    ${publicNote(ctx)}
    ${modWarning(ctx)}
    ${rulesBox}
    <div class="t10-bar" data-bar>${actionBar(ctx, d, e, access)}</div>
    <div class="t10-drawer" data-drawer hidden role="dialog" aria-modal="true" aria-labelledby="t10-drawer-h">
      <div class="t10-drawer-panel" tabindex="-1"><div class="t10-drawer-head"><h2 id="t10-drawer-h" class="m-0" data-drawer-title></h2>
        <button class="t10-icon" type="button" data-drawer-close aria-label="${t('Close')}">✕</button></div><div data-drawer-body></div></div>
    </div>`;
}
