// POST /api/top10/admin/action: strike, restore, hide-play, show-play, void or unvoid, for admins (see top10/api.js).
import { adminAction } from '../../../../top10/api.js';

export const onRequestPost = ({ request, env }) => adminAction(request, env);
