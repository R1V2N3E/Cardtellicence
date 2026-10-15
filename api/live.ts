import { liveHandler } from '../lib/handlers.js';

export const GET = (req: Request) => liveHandler(req);
