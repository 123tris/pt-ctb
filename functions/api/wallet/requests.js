// GET /api/wallet/requests: the signed-in player's requests and what the bot said (see economy/api.js).
import { walletRequests } from '../../../economy/api.js';

export const onRequestGet = ({ request, env }) => walletRequests(request, env);
