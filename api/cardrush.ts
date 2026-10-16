import { cardrushHandler } from '../lib/handlers.js';
import { limited } from '../lib/security.js';

export const GET = limited('cardrush', 300, 600, cardrushHandler);
