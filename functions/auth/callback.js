// GET /auth/callback: osu! sends the visitor back here (see signin/oauth.js).
import { callback } from '../../signin/oauth.js';

export const onRequestGet = ({ request, env }) => callback(request, env);
