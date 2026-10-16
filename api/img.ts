import { imgHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('img', 1500, 60, imgHandler);
