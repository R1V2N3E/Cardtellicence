import { cardHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('card', 120, 60, cardHandler);
