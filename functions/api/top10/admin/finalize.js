// POST /api/top10/admin/finalize: compute the results and queue the payouts, once, for admins (see top10/api.js).
import { adminFinalize } from '../../../../top10/api.js';

export const onRequestPost = ({ request, env }) => adminFinalize(request, env);
