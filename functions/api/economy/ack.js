// POST /api/economy/ack: the bot's answer to the inbox (see economy/api.js).
import { economyAck } from '../../../economy/api.js';

export const onRequestPost = ({ request, env }) => economyAck(request, env);
