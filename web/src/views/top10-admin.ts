// /admin?tab=top10: the admin panel's Top 10 tab (§8). The write-up queue (flagged first: write-ups are approved by
// default, and mods strike the exceptions), the showcase, the ballots, and the mod log, from
// GET /api/top10/admin/queue; each action goes to POST /api/top10/admin/action with a reason the player sees. A mod
// can't act on write-ups about themselves (the other mod handles those). Finalize: a dry run first, which shows the
// results and the payouts without saving; then the real run, once only, which the server allows once voting closes.

import { html, raw, type Safe } from '../kernel/html.ts';
import type { Ctx } from '../kernel/ctx.ts';
import type { CorePack } from '../gen/packs.ts';
import { playerLinkId, rowOf } from '../ui/players.ts';
import { signInButton } from '../ui/bananas.ts';
import { chipGroup, col, dataTable, empty, pageHead } from '../ui/page.ts';
import { adminTabs } from '../ui/admin-tabs.ts';
import { KINDS, bananasFor, flagList, kindName, replayLink, scoreCard, toSec, troubleNote, type Kind, type LogLine, type Phase, type ShowPlay, type Trouble } from '../ui/top10.ts';

/** A write-up in the queue. */
export interface QueueWriteup {
  voter: number;
  subject: number;
  body: string;
  words: number;
  flags: string[] | string | null;
  mod: 'ok' | 'struck';
  mod_reason?: string | null;
  updated?: string | number | null;
  /** About a pick, so it pays (rather than a mention or one to watch). */
  ranked?: boolean;
  cites?: string[];
  ballot_status?: 'draft' | 'submitted' | 'void';
  /** What an action names it by ("writeup:<voter>:<subject>"), and whether it's yours to leave (about you or by you). */
  target?: string;
  own?: boolean;
}

export interface QueueBallot {
  voter: number;
  status: 'draft' | 'submitted' | 'void';
  picks?: number | unknown[];
  submitted_at?: string | number | null;
  void_reason?: string | null;
  target?: string;
  own?: boolean;
}

export interface Queue {
  year?: number;
  phase?: Phase;
  finalized?: boolean;
  writeups: QueueWriteup[];
  plays: ShowPlay[];
  ballots: QueueBallot[];
  log: LogLine[];
}

export interface Data {
  /** Which ballot's queue (§13.11): write-ups and ballots are per kind; the showcase lists both scopes. */
  kind: Kind;
  core: CorePack;
  signInHere: boolean;
  status: number;
  trouble: Trouble;
  queue: Queue | null;
}

export type WriteupFilter = 'flagged' | 'all' | 'struck';

const nameOf = (core: CorePack, id: number) => { const r = rowOf(core.players, id); return r < 0 ? `#${id}` : core.players.name.at(r); };

/** The reason box an action opens under its item. */
export const reasonForm = (ctx: Ctx, action: string, target: string, needed: boolean): Safe => html`<form class="t10-reason" data-reason-form data-action="${action}" data-target="${target}">
  <input class="input" name="reason" maxlength="300" ${needed ? raw('required') : ''} placeholder="${needed ? ctx.t('Reason (the player sees it)') : ctx.t('Reason (optional)')}" aria-label="${ctx.t('Reason')}">
  <button class="btn btn-small btn-primary" type="submit">${ctx.t('Confirm')}</button>
  <button class="btn btn-small" type="button" data-cancel>${ctx.t('Cancel')}</button></form>`;

export function writeupList(ctx: Ctx, d: Data, filter: WriteupFilter): Safe {
  const { t, fmt } = ctx;
  const all = d.queue?.writeups ?? [];
  const list = all.filter(w => (filter === 'flagged' ? flagList(w.flags).length > 0 : filter === 'struck' ? w.mod === 'struck' : true))
    .sort((a, b) => Number(flagList(b.flags).length > 0) - Number(flagList(a.flags).length > 0) || toSec(b.updated) - toSec(a.updated));
  if (!list.length) return empty(filter === 'flagged' ? t('Nothing flagged. Write-ups are approved unless struck.') : t('Nothing here.'));
  return html`<ul class="t10-queue">${list.map(w => {
    const flags = flagList(w.flags);
    // The server says what's yours to leave (about you or by you); without it, at least those about you.
    const self = w.own ?? (w.subject === ctx.me || w.voter === ctx.me);
    const target = w.target ?? `${w.voter}:${w.subject}`;
    return html`<li class="t10-q ${w.mod === 'struck' ? 't10-q-struck' : ''}" data-item="${target}">
      <div class="t10-q-head">${playerLinkId(ctx, d.core.players, w.voter, 'avatar-sm')} <span class="faint">→</span> ${playerLinkId(ctx, d.core.players, w.subject, 'avatar-sm')}
        <span class="small faint">${t('{n} words', { n: fmt.num(w.words) })}${w.ranked === false ? ` · ${t('mention, no bananas')}` : ` · 🍌 ${fmt.num(flags.length || w.mod === 'struck' ? 0 : bananasFor(w.words))}`}</span>
        ${flags.map(f => html`<span class="t10-pill t10-pill-warn">${f}</span>`)}
        ${w.mod === 'struck' ? html`<span class="t10-pill t10-pill-warn">${t('struck')}</span>` : ''}</div>
      <p class="t10-q-body">${w.body}</p>
      ${w.mod === 'struck' && w.mod_reason ? html`<p class="small muted">${t('Reason: {reason}', { reason: w.mod_reason })}</p>` : ''}
      <div class="btn-row">${self ? html`<span class="small faint">${t('About you or by you: the other mod handles this one.')}</span>`
        : w.mod === 'struck' || flags.length ? html`<button class="btn btn-small" type="button" data-act="restore" data-target="${target}">${flags.length && w.mod !== 'struck' ? t('Clear the flags') : t('Restore')}</button>` : ''}
        ${!self && w.mod !== 'struck' ? html`<button class="btn btn-small" type="button" data-act="strike" data-target="${target}">${t('Strike')}</button>` : ''}</div>
      <div data-reason-slot></div>
    </li>`;
  })}</ul>`;
}

function playsList(ctx: Ctx, d: Data): Safe {
  const { t } = ctx;
  const plays = d.queue?.plays ?? [];
  if (!plays.length) return empty(t('Nothing showcased yet.'));
  return html`<ul class="t10-queue">${plays.map(p => html`<li class="t10-q ${p.status === 'hidden' ? 't10-q-struck' : ''}" data-item="p${p.id}">
    <div class="t10-q-head">${playerLinkId(ctx, d.core.players, p.player, 'avatar-sm')} <span class="small faint">${t('shown by {name}', { name: nameOf(d.core, p.submitter) })} · 🔥 ${p.endorsements ?? 0}</span>
      ${p.clip ? html`<span class="t10-pill">🎬 ${t('clip')}</span>` : ''}${p.scope === 'alltime' ? html`<span class="t10-pill t10-pill-legend">👑 ${t('legendary')}</span>` : ''}${p.status === 'hidden' ? html`<span class="t10-pill t10-pill-warn">${t('hidden')}</span>` : ''}</div>
    ${p.score ? scoreCard(ctx, p.score, p.score_ref) : ''}${p.clip ? html`<a href="${p.clip}" target="_blank" rel="noopener">${p.clip}</a>` : ''}
    ${replayLink(ctx, p.replay)}${p.status === 'hidden' && p.reason ? html`<p class="small muted">${t('Reason: {reason}', { reason: p.reason })}</p>` : ''}
    ${p.caption ? html`<p class="t10-caption">“${p.caption}”</p>` : ''}
    <div class="btn-row">${p.status === 'hidden' ? html`<button class="btn btn-small" type="button" data-act="show-play" data-target="${p.target ?? p.id}">${t('Show again')}</button>`
      : html`<button class="btn btn-small" type="button" data-act="hide-play" data-target="${p.target ?? p.id}">${t('Hide')}</button>`}</div>
    <div data-reason-slot></div></li>`)}</ul>`;
}

function ballotsTable(ctx: Ctx, d: Data): Safe {
  const { t, fmt } = ctx;
  const ballots = d.queue?.ballots ?? [];
  if (!ballots.length) return empty(t('No ballots yet.'));
  const label = (s: string) => ({ draft: t('Draft'), submitted: t('Submitted'), void: t('Voided') } as Record<string, string>)[s] ?? s;
  return dataTable(t('Ballots'), html`${col(t('Voter'))}${col(t('Status'))}${col(t('Players'), 'num')}${col(t('Submitted'))}${col('')}`,
    ballots.map(b => html`<tr data-item="b${b.voter}"><td>${playerLinkId(ctx, d.core.players, b.voter, 'avatar-sm')}</td>
      <td>${label(b.status)}${b.void_reason ? html`<div class="small faint">${b.void_reason}</div>` : ''}</td>
      <td class="num">${fmt.num(Array.isArray(b.picks) ? b.picks.length : b.picks ?? 0)}</td>
      <td>${toSec(b.submitted_at) ? fmt.date(toSec(b.submitted_at)) : '—'}</td>
      <td>${b.own ? html`<span class="small faint">${t('Yours: the other mod handles it.')}</span>`
        : b.status === 'void' ? html`<button class="btn btn-small" type="button" data-act="unvoid" data-target="${b.target ?? b.voter}">${t('Unvoid')}</button>`
        : b.status === 'submitted' ? html`<button class="btn btn-small" type="button" data-act="void" data-target="${b.target ?? b.voter}">${t('Void')}</button>` : ''}<div data-reason-slot></div></td></tr>`));
}

function logList(ctx: Ctx, d: Data): Safe {
  const { t, fmt } = ctx;
  const log = d.queue?.log ?? [];
  return log.length ? html`<ul class="admin-log">${log.slice(0, 100).map(l => html`<li><b>${nameOf(d.core, l.admin)}</b> ${l.action} <code>${l.target}</code>${l.kind === 'alltime' || l.target.includes(':alltime:') ? html` <span class="t10-pill t10-pill-legend">👑</span>` : ''}${l.reason ? html` · ${l.reason}` : ''}
      ${toSec(l.at) ? html` <span class="faint small">${fmt.dateTime(toSec(l.at))}</span>` : ''}</li>`)}</ul>` : html`<p class="small faint">${t('Nothing yet.')}</p>`;
}

/** What a finalize (or its dry run) answered: the results table and the payouts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function finalizePreview(ctx: Ctx, core: CorePack, out: any): Safe {
  const { t } = ctx;
  const res = out?.results ?? out;
  // Finalize does both kinds in one action (§13.11): { results: { year, alltime } }, each null when that kind had fewer
  // than 5 ballots and stays unpublished ({ unpublished: [{ kind, ballots }] }); a server from before kinds sends one.
  const both = res && typeof res === 'object' && !Array.isArray(res.ranking) && ('year' in res || 'alltime' in res);
  const byKind: [Kind, unknown][] = both ? KINDS.map(k => [k, res[k] ?? null]) : [['year', res]];
  const year = Number(out?.year ?? (both ? res.year?.year ?? res.alltime?.year : res?.year)) || 0;
  const left = (k: Kind) => (Array.isArray(out?.unpublished) ? out.unpublished : []).find((u: { kind?: string }) => (u.kind ?? 'year') === k);
  const payouts = (k: Kind) => (out?.payouts ?? []).filter((p: { payload?: { kind?: string } }) => (p.payload?.kind ?? 'year') === k);
  const thanks = (k: Kind) => (out?.thanks ?? []).filter((p: { payload?: { kind?: string } }) => (p.payload?.kind ?? 'year') === k);
  return html`<p>${out?.dryRun === false ? html`<b>${t('Finalized.')}</b>` : html`<b>${t('Dry run: nothing was saved.')}</b>`}</p>
    ${byKind.map(([k, r]) => html`${both ? html`<h3 class="t10-h3">${kindName(ctx, k, year)}</h3>` : ''}
      ${r ? kindPreview(ctx, core, r, payouts(k), thanks(k))
        : html`<p class="notice">${t('Unpublished: {n} counted ballots, and the results need at least 5. Nothing is paid for this ballot.', { n: ctx.fmt.num(Number(left(k)?.ballots ?? 0)) })}</p>`}`)}`;
}

/** One kind's results table and payouts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kindPreview(ctx: Ctx, core: CorePack, r: any, payouts: any[], thankRows: unknown[]): Safe {
  const { t, fmt } = ctx;
  const ranking: { id: number; rank: number; score: number; points: number; lists: number; eligible: number; firsts: number; best: number; worst: number }[] = r?.ranking ?? [];
  // Each queued request is { osuId, type, payload } (requestId too on the real run).
  const pays: { osuId: number; payload: { writeups: { subject: number; words: number }[]; allFull: boolean } }[] = payouts;
  const thanks: unknown[] = thankRows;
  const bananas = (p: (typeof pays)[number]) => 20 + p.payload.writeups.reduce((n, w) => n + bananasFor(w.words), 0) + (p.payload.allFull ? 30 : 0);
  return html`<p>${t('{ballots} counted ballots · {writeups} write-ups · {words} words about {subjects} players.', { ballots: fmt.num(r?.ballots ?? 0), writeups: fmt.num(r?.stats?.writeups ?? 0), words: fmt.num(r?.stats?.words ?? 0), subjects: fmt.num(r?.stats?.subjects ?? 0) })}</p>
    ${dataTable(t('Results'), html`${col('#', 'num')}${col(t('Player'))}${col(t('Score'), 'num')}${col(t('Points'), 'num')}${col(t('Lists'), 'num')}${col(t('#1s'), 'num')}${col(t('Best–worst'))}`,
      ranking.map(x => html`<tr><td class="num">${x.rank}</td><td>${playerLinkId(ctx, core.players, x.id, 'avatar-sm')}</td><td class="num"><b>${fmt.num(x.score, 2)}</b></td>
        <td class="num">${fmt.num(x.points, 1)}</td><td class="num">${t('{n} of {of}', { n: fmt.num(x.lists), of: fmt.num(x.eligible) })}</td><td class="num">${fmt.num(x.firsts)}</td><td>#${x.best}–#${x.worst}</td></tr>`))}
    <h3 class="t10-h3">${t('Payouts the bot will get')}</h3>
    <p class="small muted">${t('The bot works the amounts out itself; these are what its default config pays: 20 a ballot, 1 per word a write-up (up to 40), +30 when all are 40+ words. Plus {n} thanks at 5 each.', { n: fmt.num(thanks.length) })}</p>
    ${dataTable(t('Payouts'), html`${col(t('Voter'))}${col(t('Paid write-ups'), 'num')}${col(t('All 40+'))}${col('🍌', 'num')}`,
      pays.map(p => html`<tr><td>${playerLinkId(ctx, core.players, p.osuId, 'avatar-sm')}</td><td class="num">${fmt.num(p.payload.writeups.length)}</td><td>${p.payload.allFull ? '✅' : ''}</td><td class="num">${fmt.num(bananas(p))}</td></tr>`))}`;
}

export function render(ctx: Ctx, d: Data, filter: WriteupFilter = 'flagged'): Safe {
  const { t, fmt } = ctx;
  const kinds = html`<nav class="chips t10-kinds" aria-label="${t('Which ballot')}">${KINDS.map(k => html`<a class="chip ${k === d.kind ? 'active' : ''}"
    href="/admin?tab=top10${k === 'alltime' ? '&kind=alltime' : ''}" ${k === d.kind ? raw('aria-current="page"') : ''}>${kindName(ctx, k, d.queue?.year ?? 0)}</a>`)}</nav>`;
  const head = html`${pageHead({ title: t('Admin'), intro: t('Top 10: write-ups, the showcase and ballots. Every action is logged and shown to the player it’s about.') })}${adminTabs(ctx, 'top10')}${d.queue ? kinds : ''}`;
  if (ctx.me === null) return html`${head}${empty(html`<p>${t('Admins only.')}</p>${signInButton(ctx, d.signInHere)}`)}`;
  if (d.status === 403) return html`${head}${empty(t('Admins only.'))}`;
  if (!d.queue) return html`${head}${troubleNote(ctx, d.trouble ?? 'error')}`;
  const q = d.queue;
  const flagged = q.writeups.filter(w => flagList(w.flags).length).length;
  const struck = q.writeups.filter(w => w.mod === 'struck').length;
  return html`${head}
    <section class="section card" aria-labelledby="t10a-fin-h">
      <h2 class="card-h" id="t10a-fin-h">${t('Finalize and pay')}</h2>
      <p class="small muted">${t('Both ballots at once: a ballot with fewer than 5 counted lists is left unpublished without holding the other back.')}</p>
      <p class="small muted">${t('Computes the results and queues the payouts for the bot. Preview it first: the real run happens once, after voting closes.')}
        ${q.phase ? html` ${t('Phase: {phase}.', { phase: q.phase })}` : ''}${q.finalized ? html` <b>${t('Already finalized.')}</b>` : ''}</p>
      <div class="btn-row"><button class="btn btn-small" type="button" data-dry>${t('Preview (dry run)')}</button>
        <button class="btn btn-small btn-primary" type="button" data-final disabled>${t('Finalize for real')}</button></div>
      <div data-preview class="mt-4"></div>
    </section>
    <section class="section" aria-labelledby="t10a-wu-h">
      <h2 id="t10a-wu-h">${t('Write-ups')} <span class="faint small">${t('{all} in all · {flagged} flagged · {struck} struck', { all: fmt.num(q.writeups.length), flagged: fmt.num(flagged), struck: fmt.num(struck) })}</span></h2>
      ${chipGroup(t('Show'), 'wfilter', [['flagged', t('Flagged')], ['all', t('All')], ['struck', t('Struck')]], filter)}
      <div data-writeups>${writeupList(ctx, d, filter)}</div>
    </section>
    <section class="section" aria-labelledby="t10a-pl-h"><h2 id="t10a-pl-h">${t('Showcase')}</h2><div data-plays>${playsList(ctx, d)}</div></section>
    <section class="section" aria-labelledby="t10a-b-h"><h2 id="t10a-b-h">${t('Ballots')}</h2><div data-ballots>${ballotsTable(ctx, d)}</div></section>
    <section class="section card" aria-labelledby="t10a-log-h"><h2 class="card-h" id="t10a-log-h">${t('Mod log')}</h2><div data-log>${logList(ctx, d)}</div></section>`;
}
