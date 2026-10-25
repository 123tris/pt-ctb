// POST /api/hit: anonymous usage events from assets/js/core/track.js (see usage/store.js for what's kept).
import { recordHit } from '../../usage/store.js';

export const onRequestPost = ({ request, env }) => recordHit(request, env);
