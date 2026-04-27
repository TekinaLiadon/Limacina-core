import { FastifyRequest, FastifyReply } from "fastify";
export function logger(req: FastifyRequest["raw"], res: FastifyReply["raw"], next: () => void) {
  console.log(`Request...`);
  next();
}
