import { pricesHandler } from '../lib/handlers.js';

export const GET = (req: Request) => pricesHandler(req);
