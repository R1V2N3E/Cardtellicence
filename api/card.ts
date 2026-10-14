import { cardHandler } from '../lib/handlers.js';

export const GET = (req: Request) => cardHandler(req);
