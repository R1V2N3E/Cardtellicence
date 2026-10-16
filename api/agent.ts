import { agentHandler } from '../lib/agent.js';

export const POST = (req: Request) => agentHandler(req);
