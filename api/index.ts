import type { Request, Response } from "express";
import app, { ensureInitialized } from "../src/index.js";

/**
 * Serverless function entrypoint for Vercel.
 * Ensures backend cache & aggregators are initialized before dispatching the request to Express.
 */
export default async function handler(req: Request, res: Response) {
  await ensureInitialized();
  return app(req, res);
}
