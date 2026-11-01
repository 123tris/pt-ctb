// GET /api/daily/cover?day=…: that day's cover, without naming the map (see economy/api.js).
import { dailyCover } from '../../../economy/api.js';

export const onRequestGet = ({ request, env }) => dailyCover(request, env);
