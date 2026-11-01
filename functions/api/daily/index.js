// GET /api/daily: today's paying daily game for the signed-in player (see economy/api.js).
import { daily } from '../../../economy/api.js';

export const onRequestGet = ({ request, env }) => daily(request, env);
