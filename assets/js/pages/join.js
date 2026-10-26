import { html } from '../core/html.js';
import { setTitle } from '../core/ui.js';
import { CONFIG } from '../config.js';

// Everything a newcomer needs in one place: join the Discord, verify, play. (It used to be split between the home
// page's "How to join" and a separate Verification page; #/verify now lands here.)
export default async function join(root) {
  setTitle('How to join');
  root.innerHTML = String(html`
    <header class="page-head">
      <h1>How to join</h1>
      <p>The server is for Portuguese osu!catch players. Three steps and you’re on the leaderboards.</p>
      ${CONFIG.discordInvite ? html`<div class="mt-3 btn-row">
        <a class="btn btn-discord" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>
      </div>` : ''}
    </header>

    <div class="grid grid-2">
      <div class="card">
        <h2>Step by step</h2>
        <div class="steps">
          <div class="step"><div><b>Join the Discord server</b><p>That’s where the bot lives and where the community chats, shares plays and sets up matches.</p></div></div>
          <div class="step"><div><b>Type <span class="kbd">/verify</span> in the verification channel</b><p>The bot replies to you only, with a <b>Verify with osu!</b> button. Sign in on osu!’s official page (osu.ppy.sh); the bot only asks to read your public profile. Back in Discord, within a few seconds your message shows the result and, if the account is Portuguese, you get the verified role. Nothing showed up? The confirmation page shows a code: press <b>Enter code</b> on the bot’s message and paste it there.</p></div></div>
          <div class="step"><div><b>Play!</b><p>The bot picks up everyone’s recent plays every 30 minutes. Use <span class="kbd">/rs</span> to show your latest one, and <a href="#/commands">the commands page</a> for the rest. Words you don’t know are in <a href="#/glossary">the glossary</a>.</p></div></div>
        </div>
      </div>
      <div class="card">
        <h2>Frequently asked questions</h2>
        <h3>Does the bot get my password?</h3>
        <p class="muted">No. You sign in on osu! directly; the bot only receives your name, id and country.</p>
        <h3>Can I verify two Discord accounts with the same osu! account?</h3>
        <p class="muted">No. Each osu! account can only verify one Discord account.</p>
        <h3>My account isn’t Portuguese.</h3>
        <p class="muted">The verified role is only for accounts from Portugal, but you’re always welcome to chat and play with us.</p>
        <h3>The link expired.</h3>
        <p class="muted">Each link lasts a few minutes and only works once. Type <span class="kbd">/verify</span> again.</p>
      </div>
    </div>
  `);
}
