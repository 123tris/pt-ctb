// POST /api/admin/request: queue an admin request for the bot, admins only (see economy/api.js).
import { adminRequest } from '../../../economy/api.js';

export const onRequestPost = ({ request, env }) => adminRequest(request, env);
