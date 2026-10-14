import { searchHandler } from '../lib/handlers.js';

export const GET = (req: Request) => searchHandler(req);
