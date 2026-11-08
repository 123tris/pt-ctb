// POST /api/top10/thanks: thank a write-up about you (see top10/api.js).
import { thank } from '../../../top10/api.js';

export const onRequestPost = ({ request, env }) => thank(request, env);
