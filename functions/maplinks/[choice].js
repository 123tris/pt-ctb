// GET /maplinks/<osu|ptcatch>[?map=<id>]: where the bot's map links take this browser (maplinks/maplinks.js). Linked
// from the Bot commands page's card, from a map page the first time a bot link lands there, and by the bot's !maplinks.
import { chooseLinks } from '../../maplinks/maplinks.js';

export const onRequestGet = ({ request, params }) => chooseLinks(request, params.choice);
