import { liveHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('live', 120, 60, liveHandler);
