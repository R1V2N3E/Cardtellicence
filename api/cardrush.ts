import { cardrushHandler } from '../lib/handlers.js';

export const GET = (req: Request) => cardrushHandler(req);
