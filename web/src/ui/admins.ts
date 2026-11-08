// Who the admins are, which the top bar's You menu needs too (a link to the admin panel), in a file of its own so the
// app's shell doesn't carry the admin panel's texts (ui/admin.ts, which re-exports this).

/** The admins when admin.json doesn't say (the bot's and the server's default, economy/api.js ADMIN_DEFAULT). */
const ADMIN_DEFAULT = [3821475, 6205809];

/** Whether an osu! id is one of the admins, by admin.json's list (or the default without one). */
export const isAdmin = (id: number | null, panel: { admins?: readonly { osuId: number }[] } | null): boolean =>
  Boolean(id) && (panel?.admins?.length ? panel.admins.map(a => a.osuId) : ADMIN_DEFAULT).includes(id!);
