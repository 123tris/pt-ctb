// GET /auth/login: start "Sign in with osu!" (see signin/oauth.js).
import { login } from '../../signin/oauth.js';

export const onRequestGet = ({ request, env }) => login(request, env);
