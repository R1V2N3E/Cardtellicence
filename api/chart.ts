import { chartHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('chart', 120, 60, chartHandler);
