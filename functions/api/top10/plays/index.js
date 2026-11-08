// GET /api/top10/plays?year=…&player=…: the score showcase; POST /api/top10/plays: add to it (see top10/api.js).
import { plays, addPlay } from '../../../../top10/api.js';

export const onRequestGet = ({ request, env }) => plays(request, env);
export const onRequestPost = ({ request, env }) => addPlay(request, env);
