// DELETE /api/top10/plays/:id: remove your own showcase entry (see top10/api.js).
import { deletePlay } from '../../../../../top10/api.js';

export const onRequestDelete = ({ request, env, params }) => deletePlay(request, env, params.id);
