import { z } from "zod";

export const artifactSchema = z.object({
  type: z.string(),
  url: z.string().url(),
});

export const agentResultBodySchema = z.object({
  intent_id: z.string().uuid(),
  status: z.enum(["DONE", "FAILED"]),
  summary: z.string().optional(),
  artifacts: z.array(artifactSchema).default([]),
});

export type AgentResultBody = z.infer<typeof agentResultBodySchema>;
