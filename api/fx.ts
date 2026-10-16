import { fxHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('fx', 120, 60, () => fxHandler());
