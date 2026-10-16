import { pricesHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('prices', 120, 60, pricesHandler);
