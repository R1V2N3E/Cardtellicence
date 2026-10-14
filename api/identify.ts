import { identifyHandler } from '../lib/handlers.js';

export const POST = (req: Request) => identifyHandler(req);
