// GET /api/top10: the season, its phase and turnout, and your eligibility and ballot when signed in (see top10/api.js).
import { hub } from '../../../top10/api.js';

export const onRequestGet = ({ request, env }) => hub(request, env);
