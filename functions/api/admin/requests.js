// GET /api/admin/requests: an admin's own admin requests and what the bot said (see economy/api.js).
import { adminRequests } from '../../../economy/api.js';

export const onRequestGet = ({ request, env }) => adminRequests(request, env);
