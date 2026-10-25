// GET /stats: the owner's usage dashboard (usage/dashboard.js). Password: the STATS_PASSWORD secret.
import { stats } from '../usage/dashboard.js';

export const onRequestGet = ({ request, env }) => stats(request, env);
