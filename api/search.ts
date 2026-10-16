import { searchHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('search', 120, 60, searchHandler);
