import type { IncomingMessage, ServerResponse } from "node:http";
export declare function handleOAuthRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
