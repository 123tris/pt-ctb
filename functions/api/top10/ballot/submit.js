// POST /api/top10/ballot/submit: make your ballot public and count (see top10/api.js).
import { submitBallot } from '../../../../top10/api.js';

export const onRequestPost = ({ request, env }) => submitBallot(request, env);
