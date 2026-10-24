import { html } from '../core/html.js';
import { setTitle } from '../core/ui.js';
import { CONFIG } from '../config.js';

export default async function verify(root) {
  setTitle('Verification');
  root.innerHTML = String(html`
    <header class="page-head">
      <span class="eyebrow">Verification</span>
      <h1>How /verify works</h1>
      <p>The server is for Portuguese osu!catch players. To prove the osu! account really is yours, the bot uses osu!’s official sign-in, so nobody has to paste profile links or take anyone’s word for it.</p>
    </header>

    <div class="grid grid-2">
      <div class="card">
        <h2>Step by step</h2>
        <div class="steps">
          <div class="step"><div><b>Type <span class="kbd">/verify</span> in the verification channel</b><p>The bot replies to you only, with a <b>Verify with osu!</b> button to sign in to osu!.</p></div></div>
          <div class="step"><div><b>Authorise on the osu! website</b><p>It’s osu!’s official page (osu.ppy.sh). The bot only asks to read your public profile.</p></div></div>
          <div class="step"><div><b>Go back to Discord</b><p>The next page hands the code back to the bot. Within a few seconds your /verify message shows the result and, if the account is Portuguese, you get the role.</p></div></div>
          <div class="step"><div><b>Nothing showed up?</b><p>The confirmation page shows a code. Press <b>Enter code</b> on the bot’s message and paste it there.</p></div></div>
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
        ${CONFIG.discordInvite ? html`<a class="btn btn-discord" href="${CONFIG.discordInvite}" target="_blank" rel="noopener">Join the Discord</a>` : ''}
      </div>
    </div>
  `);
}
