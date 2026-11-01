// The paying daily game's map: Guess the map, signed in, checked here. The browser-only games (pages/games.js) pick
// their maps in the browser and pay nothing; this one picks on the server from DAILY_SEED, a secret, so nobody can work
// out a day's answer ahead, and the browser is only told the six options until the game is over. The cover comes
// through /api/daily/cover, so not even its address (which has the set id) gives the map away.
//
// The pool is the same as the free daily's: the 300 most-played sets of quiz.json, read from the site's data on R2.

import { CONFIG } from '../assets/js/config.js';
import { hashedName } from '../assets/js/core/data-name.js';

export const POOL = 300;
export const OPTIONS = 6;

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`ptctb-daily-v1|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new DataView(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

/**
 * The round for `day` from `sets` (quiz.json's [setId, artist, title, mapper, players], most played first):
 * { day, options: [[setId, artist, title, mapper]] × 6, answer: the right option's index }. The same seed, day and pool
 * always give the same round. The five wrong options never share the answer's title.
 */
export async function pickRound(seed, day, sets) {
  const pool = sets.slice(0, POOL);
  if (pool.length < OPTIONS) throw new Error('The quiz pool is too small for the daily game.');
  const draw = async (label, n) => (await hmac(seed, `${day}|${label}`)).getUint32(0) % n;
  const answer = pool[await draw('answer', pool.length)];
  const others = pool.filter(s => s[0] !== answer[0] && s[2] !== answer[2]);
  const wrong = [];
  for (let i = 0; wrong.length < OPTIONS - 1 && others.length; i++) wrong.push(others.splice(await draw(`wrong${i}`, others.length), 1)[0]);
  const at = await draw('place', OPTIONS);
  const options = [...wrong.slice(0, at), answer, ...wrong.slice(at)].map(s => s.slice(0, 4));
  return { day, options, answer: at };
}

/** quiz.json's sets from the site's data (`base`: CONFIG.data, or DATA_URL where a test or local run sets one). */
export async function quizSets(base = CONFIG.data) {
  const meta = await (await fetch(new URL('meta.json', base), { cf: { cacheTtl: 60 } })).json();
  const hash = meta.files?.['quiz.json'];
  const response = await fetch(new URL(hash ? hashedName('quiz.json', hash) : 'quiz.json', base));
  if (!response.ok) throw new Error(`quiz.json answered HTTP ${response.status}.`);
  return (await response.json()).sets;
}
