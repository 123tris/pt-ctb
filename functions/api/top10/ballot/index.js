// GET /api/top10/ballot: your own ballot; PUT /api/top10/ballot: save it (see top10/api.js).
import { myBallot, saveBallot } from '../../../../top10/api.js';

export const onRequestGet = ({ request, env }) => myBallot(request, env);
export const onRequestPut = ({ request, env }) => saveBallot(request, env);
