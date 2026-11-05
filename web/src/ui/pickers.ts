// Picking a player by name: a text box with every player as a suggestion (assets/js/core/ui.js playerPicker), over the
// core pack's names.

import { html, type Safe } from '../kernel/html.ts';
import type { Players } from './players.ts';

/** A name box with every player as a suggestion, filled with `selected` (a row, or -1 for none). */
export function playerPicker(players: Players, id: string, selected: number, placeholder: string): Safe {
  const names: Safe[] = new Array(players.rows);
  for (let row = 0; row < players.rows; row++) names[row] = html`<option value="${players.name.at(row)}"></option>`;
  return html`<input class="input" id="${id}" list="${id}-names" placeholder="${placeholder}" autocomplete="off"
      value="${selected >= 0 ? players.name.at(selected) : ''}" aria-label="${placeholder}">
    <datalist id="${id}-names">${names}</datalist>`;
}

/** The row of the player whose name was typed (any case), or -1. */
export function pickedRow(players: Players, typed: string): number {
  const name = typed.trim().toLowerCase();
  for (let row = 0; row < players.rows; row++) if (players.name.at(row).toLowerCase() === name) return row;
  return -1;
}
