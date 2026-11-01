// POST /api/daily/guess: one guess at today's paying daily game (see economy/api.js).
import { dailyGuess } from '../../../economy/api.js';

export const onRequestPost = ({ request, env }) => dailyGuess(request, env);
