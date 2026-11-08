// POST /api/top10/ballot/withdraw: take your ballot back to draft (see top10/api.js).
import { withdrawBallot } from '../../../../top10/api.js';

export const onRequestPost = ({ request, env }) => withdrawBallot(request, env);
