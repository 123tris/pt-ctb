// PATCH /api/top10/plays/:id: edit your own showcase entry's caption and clip; DELETE: remove it (see top10/api.js).
import { deletePlay, editPlay } from '../../../../../top10/api.js';

export const onRequestPatch = ({ request, env, params }) => editPlay(request, env, params.id);
export const onRequestDelete = ({ request, env, params }) => deletePlay(request, env, params.id);
