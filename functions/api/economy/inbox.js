// GET /api/economy/inbox?since=…: what the bot pulls every 15 minutes (see economy/api.js).
import { economyInbox } from '../../../economy/api.js';

export const onRequestGet = ({ request, env }) => economyInbox(request, env);
