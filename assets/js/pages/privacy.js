import { html, raw } from '../core/html.js';
import { setTitle, pageHead } from '../core/ui.js';
import { trackingBlock, optOut, optIn } from '../core/track.js';
import { t, th } from '../core/i18n.js';
import { CONFIG } from '../config.js';

// What the usage counts record, why and for how long (core/track.js, usage/store.js), with the switch to turn them
// off in this browser. Linked from the footer. Keep it in step with those two files and with usage/store.js's
// RAW_KEEP_DAYS, VISITOR_KEEP_DAYS and ROLLUP_KEEP_DAYS.

const RECORDED = [
  [t('Pages and clicks'), t('Which pages you open and how you got there, how long you stay, how far down you scroll, which buttons, filters, sorts and tabs you use, game results, and the links you follow to other sites (only the site and the first part of the address).')],
  [t('Searches'), t('Whether you searched, what you picked, and the shape of what you typed, like “text, 3 to 5 characters”. Never the words themselves.')],
  [t('Your osu! player'), t('If you pressed “This is me” or signed in with osu!, your player id and name, and which of the two it was. Otherwise you’re just a random id.')],
  [t('Your browser'), t('A random id kept in this browser (not a cookie, and not worked out from your device) and one for each visit. Also your screen size class and window size, browser and operating system (not the full browser string), whether you prefer light or dark, your browser’s language, and your country, which Cloudflare tells the site.')],
  [t('Problems'), t('Error messages from the site’s code, and how long pages and data take to load.')],
];

// Markup of our own (the <b>s), so raw() below.
const STATE = {
  '': t('Usage counting is <b>on</b> in this browser.'),
  optout: t('Usage counting is <b>off</b> in this browser: you turned it off.'),
  dnt: t('Nothing is recorded: your browser sends Do Not Track.'),
  gpc: t('Nothing is recorded: your browser sends Global Privacy Control.'),
  consent: t('Nothing is recorded until you allow it.'),
  local: t('Nothing is recorded on this copy of the site.'),
};

export default async function privacy(root) {
  setTitle(t('Privacy'));
  const draw = (said = '') => {
    const block = trackingBlock();
    root.innerHTML = String(html`
      ${pageHead({ title: t('Privacy'), intro: t('What this site records about how it’s used, why, and how to turn it off.') })}
      <section class="section">
        <h2>${t('In this browser')}</h2>
        <p id="privacy-state">${raw(STATE[block] ?? STATE[''])}</p>
        <div class="btn-row">
          ${block === '' ? html`<button class="btn" type="button" data-act="off">${t('Stop counting')}</button>
            <button class="btn" type="button" data-act="erase">${t('Stop and delete my data')}</button>` : ''}
          ${block === 'optout' || block === 'consent' ? html`<button class="btn btn-primary" type="button" data-act="on">${block === 'consent' ? t('Allow counting') : t('Count again')}</button>` : ''}
        </div>
        ${said ? html`<p class="muted" role="status">${said}</p>` : ''}
      </section>
      <section class="section">
        <h2>${t('What’s recorded')}</h2>
        <dl class="glossary">${RECORDED.map(([term, text]) => html`<div><dt>${term}</dt><dd>${text}</dd></div>`)}</dl>
        <p class="muted">${t('Never recorded: your IP address, cookies, the words you search for, or anything from other sites. There are no ads and no third-party trackers, and nothing is sold or shared.')}</p>
      </section>
      <section class="section">
        <h2>${t('Why')}</h2>
        <p>${t('To see which pages and features people use, which ones nobody finds, and what’s slow or broken, so the site gets better for the players who use it. Only the site’s maintainer can see it, on a password-protected page.')}</p>
      </section>
      <section class="section">
        <h2>${t('How long it’s kept')}</h2>
        <dl class="glossary">
          <div><dt>${t('Detailed records')}</dt><dd>${t('180 days, then only anonymous daily totals are kept.')}</dd></div>
          <div><dt>${t('Your random id')}</dt><dd>${t('Replaced with a new one after 13 months. What’s stored about it goes 13 months after your last visit.')}</dd></div>
          <div><dt>${t('Anonymous totals')}</dt><dd>${t('About two years. They hold no ids, so nobody can be picked out of them.')}</dd></div>
        </dl>
        <p class="muted">${t('It’s stored with Cloudflare, which hosts the site. Want to see or delete what’s recorded about you, or have a question?')} ${CONFIG.discordInvite
          ? th('Ask in the Discord ({join}).', { join: html`<a href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${t('join here')}</a>` })
          : t('Ask in the Discord.')} ${t('“Stop and delete my data” deletes this browser’s records within a day.')}</p>
      </section>
    `);
  };
  root.addEventListener('click', e => {
    const act = e.target.closest?.('[data-act]')?.dataset.act;
    if (act === 'off') { optOut(); draw(t('Done. Nothing more is recorded in this browser.')); }
    else if (act === 'erase') { optOut({ erase: true }); draw(t('Done. Nothing more is recorded, and this browser’s records will be deleted within a day.')); }
    else if (act === 'on') { optIn(); draw(t('Thanks. Counting is on again, with a new random id.')); }
  });
  draw();
}
