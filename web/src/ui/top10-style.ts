// The Top 10 pages' styles, over site.css's tokens, mobile first. Kept with the client (put in once, as a <style>,
// which the CSP allows) so the feature lives in web/ alone; they can move into assets/css/site.css as they are.

const CSS = String.raw`
.t10-tabs { margin-bottom: var(--sp-4); }
.t10-tabs a { font-size: var(--fs-sm); }
.t10-head h1 { margin-bottom: var(--sp-1); }
.t10-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin: 0; }
.t10-state { display: inline-flex; align-items: center; gap: var(--sp-1); padding: 2px var(--sp-2); border-radius: 999px; border: 1px solid var(--border-strong); background: var(--surface-2); font-size: var(--fs-sm); font-weight: 600; color: var(--text-dim); }
.t10-state-in, .t10-state-open { border-color: var(--accent-line); background: var(--accent-bg); color: var(--accent); }
.t10-state-void { border-color: var(--red); color: var(--red); background: var(--red-bg); }
.t10-pill { display: inline-block; padding: 0 var(--sp-2); border-radius: 999px; background: var(--surface-3); color: var(--text-dim); font-size: var(--fs-xs); font-weight: 600; line-height: 1.6; white-space: nowrap; }
.t10-pill-warn { background: var(--red-bg); color: var(--red); }
.t10-h3 { font-size: var(--fs-md); margin: var(--sp-6) 0 var(--sp-2); }
.t10-public { margin: var(--sp-6) 0 var(--sp-2); padding: var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); font-size: var(--fs-sm); }
.t10-modwarn { margin: 0 0 var(--sp-4); padding: var(--sp-3); border-radius: var(--r); border: 1px solid var(--accent-line); background: var(--accent-bg); color: var(--text); font-size: var(--fs-sm); }
.t10-rules { margin: 0; padding-left: 1.4em; display: grid; gap: var(--sp-1); color: var(--text-dim); }
.t10-rules .t10-warn { color: var(--text); font-weight: 600; }
.t10-rules-box { margin: var(--sp-4) 0; }
.t10-rules-box > summary, .t10-extras > summary, .t10-add > summary { cursor: pointer; font-weight: 600; padding: var(--sp-2) 0; }
.t10-struck { border-color: var(--red); }

/* The hub */
.t10-hero p { max-width: 62ch; }
.t10-phase { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); margin-bottom: var(--sp-4); }
.t10-turnout b { font-size: var(--fs-xl); color: var(--text); }
.t10-cta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-3); padding: var(--sp-4); border-radius: var(--r); border: 1px solid var(--border); background: var(--surface); margin: var(--sp-4) 0; }
.t10-cta-go { border-color: var(--accent-line); }
.t10-cta p { flex: 1 1 260px; }
.t10-cd { display: flex; gap: var(--sp-2); margin: var(--sp-3) 0; }
.t10-cd-box { display: grid; justify-items: center; min-width: 64px; padding: var(--sp-2) var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); }
.t10-cd-box b { font-family: var(--display); font-size: var(--fs-3xl); line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--accent); }
.t10-cd-box small { color: var(--text-faint); font-size: var(--fs-xs); }
.t10-soon .t10-done-big { font-size: var(--fs-4xl); }
.t10-past { justify-content: center; margin-top: var(--sp-4); }
.section > .t10-past { justify-content: flex-start; }

/* The list */
.t10-list-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); flex-wrap: wrap; }
.t10-list-head h2 { margin: 0; }
.t10-count { font-size: var(--fs-sm); color: var(--text-dim); font-weight: 600; }
.t10-count-ok { color: var(--accent); }
.t10-list { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: grid; gap: var(--sp-1); }
.t10-slot { display: flex; align-items: center; gap: var(--sp-2); min-height: 48px; padding: var(--sp-1) var(--sp-2); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); }
.t10-slot[draggable="true"] { cursor: grab; }
.t10-slot-empty { background: none; border-style: dashed; color: var(--text-faint); min-height: 44px; }
.t10-after { margin: var(--sp-1) 0 0; }
.t10-slot-next { border-color: var(--accent-line); color: var(--text-dim); }
.t10-slot-opt .t10-spot { opacity: .6; }
.t10-slot-tie { margin-top: -2px; border-top-color: var(--accent-line); }
.t10-slot.t10-drop { border-color: var(--accent); background: var(--accent-bg); }
.t10-slot.t10-dragging { opacity: .5; }
.t10-spot { flex: none; min-width: 2.2em; text-align: center; font-family: var(--display); font-size: var(--fs-lg); font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
.t10-grip { color: var(--text-faint); letter-spacing: -2px; display: none; }
@media (pointer: fine) { .t10-grip { display: inline; } }
.t10-slot-who { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; flex: 1; }
.t10-slot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.t10-slot-hint { font-size: var(--fs-sm); }
.t10-slot-tools { display: flex; align-items: center; gap: 2px; flex: none; }
.t10-icon { display: inline-grid; place-items: center; width: 36px; height: 36px; border-radius: var(--r-sm); border: 1px solid transparent; background: none; color: var(--text-dim); font-size: var(--fs-md); cursor: pointer; }
.t10-icon:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
.t10-icon:disabled { opacity: .3; cursor: default; }
.t10-x:hover:not(:disabled) { color: var(--red); }
.t10-tie { display: inline-flex; align-items: center; gap: var(--sp-1); height: 30px; padding: 0 var(--sp-2); border-radius: 999px; border: 1px solid var(--border-strong); background: none; color: var(--text-faint); font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
.t10-tie[aria-pressed="true"] { border-color: var(--accent-line); background: var(--accent-bg); color: var(--accent); }
@media (max-width: 420px) { .t10-tie-text { display: none; } .t10-tie { width: 30px; justify-content: center; padding: 0; } .t10-icon { width: 32px; } }

/* Extras */
.t10-extras { margin: var(--sp-4) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.t10-extras-sub { display: block; font-weight: 400; }
.t10-extras-body { display: grid; gap: var(--sp-3); padding-bottom: var(--sp-4); }
.t10-extras-body .t10-h3 { margin-top: var(--sp-2); }
.t10-extra-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-1); }
.t10-extra-list li { display: inline-flex; align-items: center; gap: var(--sp-1); padding-left: var(--sp-2); border-radius: 999px; background: var(--surface-2); }
.t10-field { display: grid; gap: var(--sp-1); font-size: var(--fs-sm); color: var(--text-dim); font-weight: 500; }
.t10-field-inline { display: inline-flex; align-items: center; gap: var(--sp-2); }
.t10-field[hidden], [data-for][hidden] { display: none; }
textarea.input { height: auto; min-height: 5.5em; padding: var(--sp-2) var(--sp-3); line-height: 1.5; resize: vertical; width: 100%; font: inherit; }

/* The picker */
.t10-picker { margin-top: var(--sp-8); }
.t10-picker h2 { margin-bottom: var(--sp-1); }
.t10-picker > .chips { margin-top: var(--sp-3); }
.t10-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-4); margin: var(--sp-3) 0; }
.t10-search { flex: 1 1 200px; max-width: 320px; }
.t10-cards { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.t10-card { position: relative; display: flex; align-items: stretch; border-radius: var(--r); border: 1px solid var(--border); background: var(--surface); }
.t10-card-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border: 0; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; border-radius: var(--r) 0 0 var(--r); }
.t10-card-main:hover { background: var(--surface-2); }
.t10-card-text { display: grid; gap: 2px; min-width: 0; }
.t10-card-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t10-card-rank { font-size: var(--fs-xs); color: var(--text-dim); }
.t10-card-chips { display: flex; flex-wrap: wrap; gap: 2px var(--sp-1); }
.t10-card-chips span { font-size: var(--fs-xs); color: var(--text-faint); }
.t10-card-chips span + span::before { content: "· "; }
.t10-card-badge { margin-left: auto; font-family: var(--display); font-weight: 700; color: var(--accent); font-size: var(--fs-lg); }
.t10-card-on { border-color: var(--accent-line); background: var(--accent-bg); }
.t10-card-on .t10-card-main:hover { background: none; }
.t10-card-self { opacity: .5; }
.t10-card-self .t10-card-main { cursor: not-allowed; }
.t10-card-quiet .t10-card-name { color: var(--text-dim); }
.t10-info { flex: none; width: 44px; border: 0; border-left: 1px solid var(--border); background: none; color: var(--text-dim); font-size: var(--fs-lg); cursor: pointer; border-radius: 0 var(--r) var(--r) 0; }
.t10-info:hover { background: var(--surface-2); color: var(--text); }
.t10-none { color: var(--text-dim); padding: var(--sp-4) 0; }

/* The bottom bar */
.t10-bar { position: sticky; bottom: 0; z-index: 5; margin: var(--sp-4) calc(-1 * var(--sp-4)) 0; padding: var(--sp-2) var(--sp-4) calc(var(--sp-2) + env(safe-area-inset-bottom)); background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-top: 1px solid var(--border); }
.t10-bar:empty { display: none; }
.t10-bar-in { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--sp-2); }

/* Write-ups */
.t10-writer { display: grid; gap: var(--sp-3); }
.t10-done { padding: var(--sp-4); border-radius: var(--r); background: var(--accent-bg); border: 1px solid var(--accent-line); }
.t10-done-big { font-family: var(--display); font-size: var(--fs-2xl); font-weight: 700; margin: 0 0 var(--sp-1); }
.t10-writer-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--sp-1) var(--sp-3); }
.t10-steps { list-style: none; display: flex; flex-wrap: wrap; gap: var(--sp-1); margin: 0; padding: 0; }
.t10-step { position: relative; padding: 2px; border-radius: 999px; border: 2px solid transparent; background: none; cursor: pointer; line-height: 0; }
.t10-step .avatar { opacity: .55; }
.t10-step-done .avatar { opacity: 1; }
.t10-step-done::after { content: "✓"; position: absolute; right: -4px; bottom: -4px; font-size: 10px; line-height: 14px; width: 14px; text-align: center; border-radius: 50%; background: var(--accent); color: var(--accent-ink); }
.t10-step-on { border-color: var(--accent); }
.t10-step-on .avatar { opacity: 1; }
.t10-writer-who { display: flex; align-items: center; gap: var(--sp-3); }
.t10-writer-who .eyebrow { display: block; }
.t10-prompts .chip { font-size: var(--fs-xs); }
@media (max-width: 600px) { .t10-prompts { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-inline: calc(-1 * var(--sp-4)); padding-inline: var(--sp-4); } .t10-prompts .chip { flex: none; } }
.t10-body { min-height: 9em; }
.t10-meter { display: grid; gap: var(--sp-1); }
.t10-meter-bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.t10-meter-bar span { display: block; height: 100%; background: var(--accent); transition: width .2s; }
.t10-meter-full .t10-meter-bar span { background: var(--gold); }
.t10-meter-text { font-size: var(--fs-sm); color: var(--text-dim); font-variant-numeric: tabular-nums; }
.t10-meter-full .t10-meter-text { color: var(--gold); font-weight: 600; }
.t10-meter-flag .t10-meter-text { color: var(--red); }
.t10-flag-note { font-size: var(--fs-sm); color: var(--red); }
.t10-writer-nav { display: flex; justify-content: space-between; gap: var(--sp-2); }
.t10-cites { display: grid; gap: var(--sp-2); }
.t10-cites:empty { display: none; }
.t10-cite-pick { padding: var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); }
.t10-cite-list { list-style: none; margin: var(--sp-2) 0 0; padding: 0; display: grid; gap: var(--sp-1); max-height: 360px; overflow: auto; }
.t10-cite-list label { display: flex; align-items: center; gap: var(--sp-2); cursor: pointer; }
.t10-cite-list .t10-score { flex: 1; }

/* A score card */
.t10-score { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2); border-radius: var(--r); background: var(--surface-2); border: 1px solid var(--border); min-width: 0; }
.t10-score-bare { font-size: var(--fs-sm); }
.t10-score-cover { flex: none; width: 56px; height: 40px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-3); }
.t10-score-text { display: grid; min-width: 0; flex: 1; }
.t10-score-title { font-weight: 600; font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.t10-score-figs { font-size: var(--fs-xs); color: var(--text-dim); }

/* The drawer */
.t10-drawer { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, .55); display: flex; justify-content: flex-end; }
.t10-drawer[hidden] { display: none; }
.t10-drawer-panel { width: min(560px, 100%); height: 100%; overflow: auto; background: var(--bg); border-left: 1px solid var(--border); padding: var(--sp-4); box-shadow: var(--shadow-float); outline: none; }
.t10-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); margin-bottom: var(--sp-3); position: sticky; top: calc(-1 * var(--sp-4)); background: var(--bg); padding: var(--sp-2) 0; z-index: 1; }
@media (max-width: 600px) { .t10-drawer { align-items: flex-end; } .t10-drawer-panel { height: 88vh; border-left: 0; border-top: 1px solid var(--border); border-radius: var(--r) var(--r) 0 0; } }
body.t10-noscroll { overflow: hidden; }

/* The dossier */
.t10-stats { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.t10-split { display: grid; gap: var(--sp-2); margin-top: var(--sp-4); }
.t10-split .t10-pill { margin-right: 2px; }
.t10-plays { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.t10-plays > li { display: grid; gap: var(--sp-1); min-width: 0; }
.t10-plays-short { gap: var(--sp-1); }
.t10-show-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }

/* The ballots */
.t10-post { padding: var(--sp-4); margin-bottom: var(--sp-4); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); }
.t10-post-mine { border-color: var(--accent-line); }
.t10-post-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-3); }
.t10-post-head h2 { font-size: var(--fs-lg); }
.t10-post-head h2 a { color: var(--text); }
.t10-note-text { white-space: pre-line; color: var(--text-dim); font-style: italic; }
.t10-post-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.t10-post-list > li { border-top: 1px solid var(--border); padding-top: var(--sp-3); }
.t10-post-pick { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.t10-post-pick .t10-spot { min-width: 1.8em; text-align: left; }
.t10-post-pick .dim-link { margin-left: auto; }
.t10-post-extra h4 { margin: var(--sp-4) 0 var(--sp-2); font-size: var(--fs-sm); color: var(--text-dim); }
.t10-post-extra ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
.t10-wu { margin: var(--sp-2) 0 0 calc(1.8em + var(--sp-2)); }
.t10-wu p { margin: 0 0 var(--sp-2); line-height: 1.6; overflow-wrap: anywhere; }
.t10-wu-foot { display: flex; align-items: center; gap: var(--sp-2); }
.t10-thanks { display: inline-flex; align-items: center; gap: var(--sp-1); height: 30px; padding: 0 var(--sp-3); border-radius: 999px; border: 1px solid var(--border-strong); background: none; color: var(--text-dim); font-size: var(--fs-sm); cursor: pointer; }
.t10-thanks:hover { color: var(--text); border-color: var(--accent-line); }
.t10-thanks-on { border-color: var(--accent-line); background: var(--accent-bg); color: var(--accent); }
.t10-about { list-style: none; margin: 0; padding: 0; }
.t10-about-head { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
.t10-about-by { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); color: var(--text-dim); }
.t10-about-by b { font-family: var(--display); color: var(--accent); font-size: var(--fs-lg); }
.t10-about .t10-wu { margin-left: 0; }
.t10-index { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-1); grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.t10-index a { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.t10-index a:hover { border-color: var(--border-strong); text-decoration: none; }
.t10-index .faint { margin-left: auto; }

/* The showcase */
.t10-add { margin-bottom: var(--sp-6); }
.t10-add summary h2 { display: inline; }
.t10-add-form { display: grid; gap: var(--sp-3); margin-top: var(--sp-3); }
.t10-add-form .btn { justify-self: start; }
.t10-form-msg { margin: 0; color: var(--red); }
.t10-form-msg:empty { display: none; }
.t10-pick-plays { border: 0; padding: 0; margin: 0; }
.t10-show-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.t10-show { display: grid; gap: var(--sp-2); align-content: start; padding: var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); min-width: 0; }
.t10-show-who { display: flex; align-items: center; gap: var(--sp-2); }
.t10-caption { margin: 0; color: var(--text); font-style: italic; overflow-wrap: anywhere; }
.t10-clip { font-weight: 600; }
.t10-replay { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-1) var(--sp-2); font-weight: 600; }
.t10-file { height: auto; padding: var(--sp-2); }
.t10-show-foot { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.t10-endorse { display: inline-flex; align-items: center; gap: var(--sp-1); height: 32px; padding: 0 var(--sp-3); border-radius: 999px; border: 1px solid var(--border-strong); background: none; color: var(--text-dim); cursor: pointer; font-size: var(--fs-sm); }
.t10-endorse:hover:not(:disabled) { border-color: var(--accent-line); color: var(--text); }
.t10-endorse-on { border-color: var(--accent-line); background: var(--accent-bg); color: var(--accent); }
.t10-endorse:disabled { cursor: default; opacity: .7; }
.t10-remove { margin-left: auto; }

/* The admin tab */
.t10-queue { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-3); }
.t10-q { display: grid; gap: var(--sp-2); padding: var(--sp-3); border-radius: var(--r); background: var(--surface); border: 1px solid var(--border); }
.t10-q-struck { opacity: .7; border-style: dashed; }
.t10-q-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
.t10-q-body { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
.t10-reason { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.t10-reason .input { flex: 1 1 220px; }
`;

let added = false;

/** Puts the styles in the page, once. */
export function injectStyle(): void {
  if (added || typeof document === 'undefined') return;
  added = true;
  const style = document.createElement('style');
  style.id = 'top10-css';
  style.textContent = CSS;
  document.head.append(style);
}
