// GET /api/top10/ballots?year=…: every submitted ballot with its write-ups (see top10/api.js).
import { ballots } from '../../../top10/api.js';

export const onRequestGet = ({ request, env }) => ballots(request, env);
