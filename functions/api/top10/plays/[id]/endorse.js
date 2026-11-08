// POST /api/top10/plays/:id/endorse: endorse a showcase entry, or take it back (see top10/api.js).
import { endorse } from '../../../../../top10/api.js';

export const onRequestPost = ({ request, env, params }) => endorse(request, env, params.id);
