import { html } from '../core/html.js';
import { setTitle } from '../core/ui.js';
import { t, th } from '../core/i18n.js';
import { CONFIG } from '../config.js';

// Everything a newcomer needs in one place: join the Discord, verify, play. (It used to be split between the home
// page's "How to join" and a separate Verification page; #/verify now lands here.)
export default async function join(root) {
  setTitle(t('How to join'));
  const verify = html`<span class="kbd">/verify</span>`;
  root.innerHTML = String(html`
    <header class="page-head">
      <h1>${t('How to join')}</h1>
      <p>${t('The server is for Portuguese osu!catch players. Three steps and you’re on the leaderboards.')}</p>
      ${CONFIG.discordInvite ? html`<div class="mt-3 btn-row">
        <a class="btn btn-discord" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">${t('Join the Discord')}</a>
      </div>` : ''}
    </header>

    <div class="grid grid-2">
      <div class="card">
        <h2>${t('Step by step')}</h2>
        <div class="steps">
          <div class="step"><div><b>${t('Join the Discord server')}</b><p>${t('That’s where the bot lives and where the community chats, shares plays and sets up matches.')}</p></div></div>
          <div class="step"><div><b>${th('Type {verify} in the verification channel', { verify })}</b><p>${th('The bot replies to you only, with a {button} button. Sign in on osu!’s official page (osu.ppy.sh); the bot only asks to read your public profile. Back in Discord, within a few seconds your message shows the result and, if the account is Portuguese, you get the verified role. Nothing showed up? The confirmation page shows a code: press {enter} on the bot’s message and paste it there.', { button: html`<b>Verify with osu!</b>`, enter: html`<b>Enter code</b>` })}</p></div></div>
          <div class="step"><div><b>${t('Play!')}</b><p>${th('The bot picks up everyone’s recent plays every 15 minutes, and they reach the site within a few minutes after that. Use {rs} to show your latest one, and {commands} for the rest. Words you don’t know are in {glossary}.', {
            rs: html`<span class="kbd">/rs</span>`,
            commands: html`<a href="#/commands">${t('the commands page')}</a>`,
            glossary: html`<a href="#/glossary">${t('the glossary')}</a>`,
          })}</p></div></div>
        </div>
      </div>
      <div class="card">
        <h2>${t('Frequently asked questions')}</h2>
        <h3>${t('Does the bot get my password?')}</h3>
        <p class="muted">${t('No. You sign in on osu! directly; the bot only receives your name, id and country.')}</p>
        <h3>${t('Can I verify two Discord accounts with the same osu! account?')}</h3>
        <p class="muted">${t('No. Each osu! account can only verify one Discord account.')}</p>
        <h3>${t('My account isn’t Portuguese.')}</h3>
        <p class="muted">${t('The verified role is only for accounts from Portugal, but you’re always welcome to chat and play with us.')}</p>
        <h3>${t('The link expired.')}</h3>
        <p class="muted">${th('Each link lasts a few minutes and only works once. Type {verify} again.', { verify })}</p>
      </div>
    </div>
  `);
}
