// The players the top bar needs (the search, the You menu): the core pack's, which nearly every page has loaded
// already. Data from before the packs, where the old pages stand in for the new ones, has players.json instead: the same
// columns are made from it, so the search and the You menu keep their players there too.

import { readCore, COLOURS } from '../gen/packs.ts';
import { StrColumn } from '../kernel/ptcb.ts';
import { PacksMissing } from '../kernel/store.ts';
import { CORE } from '../routes.ts';
import type { Players } from '../ui/players.ts';
import { store } from './boot.ts';

/** A players.json entry, as far as the top bar reads it. */
interface PlayerJson {
  id: number;
  name: string;
  cv?: number;
  ul?: number;
  pp?: number;
  /** A bought name colour, and when it ends (unix seconds). */
  nc?: string;
  ncu?: number;
}

function strColumn(values: string[]): StrColumn {
  const encoder = new TextEncoder();
  const parts = values.map(v => encoder.encode(v));
  const offsets = new Uint32Array(parts.length + 1);
  parts.forEach((p, i) => { offsets[i + 1] = offsets[i] + p.length; });
  const bytes = new Uint8Array(offsets[parts.length]);
  parts.forEach((p, i) => bytes.set(p, offsets[i]));
  return new StrColumn(offsets, bytes);
}

/** The core pack's player columns the top bar reads, from players.json and meta.json's avatar thumbnails. */
function fromJson(list: PlayerJson[], files: Record<string, string>): Players {
  const hundredths = (pick: (p: PlayerJson) => number | undefined) => Int32Array.from(list, p => Math.round((pick(p) ?? 0) * 100));
  return {
    rows: list.length,
    id: Uint32Array.from(list, p => p.id),
    name: strColumn(list.map(p => p.name)),
    cv: hundredths(p => p.cv),
    ul: hundredths(p => p.ul),
    pp: hundredths(p => p.pp),
    colour: Uint8Array.from(list, p => Math.max(0, COLOURS.indexOf((p.nc ?? '') as typeof COLOURS[number]))),
    colourUntil: Uint32Array.from(list, p => p.ncu ?? 0),
    avatar64: strColumn(list.map(p => files[`avatars/${p.id}-64.webp`] ?? '')),
    avatar128: strColumn(list.map(p => files[`avatars/${p.id}-128.webp`] ?? '')),
  } as unknown as Players;
}

let players: Promise<Players | null> | null = null;

/** Every player, as rows of core.players (only the columns above for data without packs); null when there are none. */
export function shellPlayers(): Promise<Players | null> {
  players ??= store.pack(CORE, readCore).then(core => core.players, async e => {
    if (!(e instanceof PacksMissing)) throw e;
    const [list, meta] = await Promise.all([store.json<PlayerJson[]>('players.json'), store.manifest('meta.json')]);
    return fromJson(list, meta.files);
  }).catch(() => { players = null; return null; });
  return players;
}
