// GET /api/top10/results?year=…: the finalized results, from the reveal on (see top10/api.js).
import { results } from '../../../top10/api.js';

export const onRequestGet = ({ request, env }) => results(request, env);
