// POST /api/wallet/request: queue a spending request for the bot (see economy/api.js).
import { walletRequest } from '../../../economy/api.js';

export const onRequestPost = ({ request, env }) => walletRequest(request, env);
