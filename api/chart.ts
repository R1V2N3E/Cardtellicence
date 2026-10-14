import { chartHandler } from '../lib/handlers.js';

export const GET = (req: Request) => chartHandler(req);
