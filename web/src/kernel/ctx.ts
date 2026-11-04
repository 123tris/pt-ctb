// What a view is drawn with: the language, the formatters, the clock, where the data is, and who's looking. render()
// takes nothing else, so the same view can be drawn in the browser or (later) at the edge.

import type { Text } from './i18n.ts';
import type { Fmt } from './fmt.ts';

export interface Ctx extends Text {
  readonly fmt: Fmt;
  /** Unix seconds: the visitor's clock in the browser, the data's time at the edge. */
  now(): number;
  /** Where the data files are (CONFIG.data): https://data.ptcatch.com/, or data/ locally. */
  readonly data: string;
  /** The signed-in visitor's osu! id, or null (always null at the edge). */
  readonly me: number | null;
}
