// GET /api/top10/admin/queue?year=…: write-ups, showcase entries, ballots and the mod log, for admins (see top10/api.js).
import { adminQueue } from '../../../../top10/api.js';

export const onRequestGet = ({ request, env }) => adminQueue(request, env);
