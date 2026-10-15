import { pushHandler } from '../lib/handlers.js';

export const GET = (req: Request) => pushHandler(req);
export const POST = (req: Request) => pushHandler(req);
