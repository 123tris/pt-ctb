// The admin panel's data (contract §8): the bot's Admin/panel.json, published as admin.json for the site's #/admin
// page. It's public on R2, so it's rebuilt field by field: the settings schema with current values and defaults, the
// admins' osu! ids and names, and the last 100 admin actions. Anything else the bot adds is dropped until the site
// knows it, and nothing here is a Discord id (a moderator acting from Discord without a linked osu! account shows by
// their Discord username, with no id).

const TYPES = ['int', 'double', 'bool', 'intList'];
const EFFECTS = ['now', 'next_draft', 'next_recap'];
const VIAS = ['site', 'discord'];
const STATUSES = ['accepted', 'rejected'];
// The payload fields of the admin.* kinds; an action's `args` keeps only these.
const ARG_KEYS = ['key', 'value', 'slot', 'tier', 'id', 'refund', 'osuId', 'amount', 'note', 'beatmapId'];

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\p{Cc}]/gu, ' ').trim().slice(0, max) : null);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const osuId = v => (Number.isSafeInteger(v) && v > 0 && v < 1e10 ? v : null);
const settingKey = v => (typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]{0,40}(\.[A-Za-z][A-Za-z0-9]{0,40}){1,2}$/.test(v) ? v : null);

/** A setting's value for its type, or undefined when it doesn't fit. */
function valueOf(type, v) {
  if (type === 'bool') return typeof v === 'boolean' ? v : undefined;
  if (type === 'intList') return Array.isArray(v) && v.length <= 10 && v.every(Number.isSafeInteger) ? v : undefined;
  if (type === 'int') return Number.isSafeInteger(v) ? v : undefined;
  return num(v) ?? undefined;
}

function setting(s) {
  const key = settingKey(s?.key);
  const type = TYPES.includes(s?.type) ? s.type : null;
  const group = text(s?.group, 40);
  if (!key || !type || !group) return null;
  const value = valueOf(type, s.value);
  const fallback = valueOf(type, s.default);
  if (value === undefined || fallback === undefined) return null;
  return {
    key, group, type,
    min: num(s.min), max: num(s.max), step: num(s.step), length: Number.isSafeInteger(s.length) && s.length > 0 ? s.length : null,
    value, default: fallback, overridden: s.overridden === true,
    effect: EFFECTS.includes(s.effect) ? s.effect : 'now',
    description: text(s.description, 200) ?? '',
  };
}

function args(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return {};
  const out = {};
  for (const k of ARG_KEYS) {
    const v = a[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = text(v, 100);
    else if (Array.isArray(v) && v.length <= 10 && v.every(n => typeof n === 'number' && Number.isFinite(n))) out[k] = v;
  }
  return out;
}

function action(a) {
  const kind = typeof a?.kind === 'string' && /^admin\.[a-z.]{1,40}$/.test(a.kind) ? a.kind : null;
  const at = typeof a?.at === 'string' && !Number.isNaN(Date.parse(a.at)) ? a.at : null;
  const status = STATUSES.includes(a?.status) ? a.status : null;
  if (!kind || !at || !status) return null;
  const requestId = typeof a.requestId === 'string' && /^([0-9a-f]{24}|discord:[0-9a-f-]{36})$/.test(a.requestId) ? a.requestId : null;
  const code = status === 'rejected' && typeof a.code === 'string' && /^[a-z_]{1,40}$/.test(a.code) ? a.code : null;
  return {
    at, ...(requestId ? { requestId } : {}), osuId: osuId(a.osuId), name: text(a.name, 40) ?? '',
    via: VIAS.includes(a.via) ? a.via : 'site', kind, args: args(a.args), status,
    reason: text(a.reason, 300) ?? '', ...(code ? { code } : {}),
  };
}

/** admin.json from the bot's panel.json, or null when there's none (the panel isn't on yet). */
export function adminFile(panel) {
  if (!panel || typeof panel !== 'object' || !Array.isArray(panel.settings)) return null;
  return {
    generatedAt: Number.isSafeInteger(panel.generatedAt) ? panel.generatedAt : null,
    admins: (Array.isArray(panel.admins) ? panel.admins : []).map(a => ({ osuId: osuId(a?.osuId), name: text(a?.name, 40) ?? '' })).filter(a => a.osuId),
    settings: panel.settings.map(setting).filter(Boolean),
    actions: (Array.isArray(panel.actions) ? panel.actions : []).slice(0, 100).map(action).filter(Boolean),
  };
}
