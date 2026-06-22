import { z } from "zod";
import { createRouter, adminQuery, authedQuery, callerQuery } from "./middleware";
import { listCompanyScope } from "./lib/authz";
import {
  findAIAgentsByCompany, findAIAgentById, createAIAgent, updateAIAgent, deleteAIAgent,
  findConversationsByAgent, createAIConversation, updateConversationTranscript,
} from "./queries/aiAgents";

export const aiAgentRouter = createRouter({
  // ─── AI Agent CRUD ───
  list: authedQuery.query(async ({ ctx }) => {
    const scope = listCompanyScope(ctx.user);
    if (scope === null) return [];
    return findAIAgentsByCompany(scope);
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return findAIAgentById(input.id);
    }),

  create: adminQuery
    .input(z.object({
      name: z.string().min(1),
      voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("alloy"),
      voiceProvider: z.enum(["openai", "elevenlabs", "cartesia", "voice_clone"]).default("openai"),
      voiceId: z.string().optional(),
      ttsModel: z.string().optional(),
      voiceCloneName: z.string().optional(),
      voiceCloneSample: z.string().optional(),
      latencyMode: z.enum(["ultra_low", "low", "balanced", "quality"]).default("low"),
      knowledgeBase: z.array(z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
      })).optional(),
      language: z.string().default("en"),
      greeting: z.string().optional(),
      systemPrompt: z.string().optional(),
      script: z.array(z.object({
        step: z.number(),
        message: z.string(),
        expectedResponse: z.string().optional(),
        action: z.string().optional(),
      })).optional(),
      maxRetries: z.number().default(2),
      timeoutSeconds: z.number().default(30),
    }))
    .mutation(async ({ ctx, input }) => {
      const companyId = ctx.user.companyId;
      if (!companyId) throw new Error("No company");
      const id = await createAIAgent({
        ...input,
        companyId,
        createdBy: ctx.user.id,
        isActive: true,
      });
      return { id, success: true };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number(),
      data: z.object({
        name: z.string().optional(),
        voice: z.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).optional(),
        voiceProvider: z.enum(["openai", "elevenlabs", "cartesia", "voice_clone"]).optional(),
        voiceId: z.string().optional(),
        ttsModel: z.string().optional(),
        voiceCloneName: z.string().optional(),
        voiceCloneSample: z.string().optional(),
        latencyMode: z.enum(["ultra_low", "low", "balanced", "quality"]).optional(),
        knowledgeBase: z.array(z.object({
          id: z.string(),
          title: z.string(),
          content: z.string(),
        })).optional(),
        language: z.string().optional(),
        greeting: z.string().optional(),
        systemPrompt: z.string().optional(),
        script: z.array(z.object({
          step: z.number(),
          message: z.string(),
          expectedResponse: z.string().optional(),
          action: z.string().optional(),
        })).optional(),
        maxRetries: z.number().optional(),
        timeoutSeconds: z.number().optional(),
        isActive: z.boolean().optional(),
      }).partial(),
    }))
    .mutation(async ({ input }) => {
      await updateAIAgent(input.id, input.data);
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await deleteAIAgent(input.id);
      return { success: true };
    }),

  // ─── Conversations ───
  conversations: authedQuery
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      return findConversationsByAgent(input.agentId);
    }),

  startCall: callerQuery
    .input(z.object({
      agentId: z.number(),
      leadId: z.number(),
      campaignId: z.number().optional(),
      callId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await createAIConversation({
        ...input,
        transcript: [],
        duration: 0,
      });
      return { id, success: true };
    }),

  updateTranscript: callerQuery
    .input(z.object({
      conversationId: z.number(),
      transcript: z.array(z.object({
        speaker: z.enum(["ai", "human"]),
        text: z.string(),
        timestamp: z.string(),
      })),
      sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
      outcome: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await updateConversationTranscript(
        input.conversationId,
        input.transcript,
        input.sentiment,
        input.outcome,
      );
      return { success: true };
    }),

  // ─── Simulate AI Call ───
  simulate: callerQuery
    .input(z.object({
      agentId: z.number(),
      leadId: z.number(),
      leadPhone: z.string(),
      leadName: z.string(),
    }))
    .mutation(async ({ input }) => {
      // Simulated AI call response
      const mockTranscript = [
        { speaker: "ai" as const, text: `Hello, this is an AI assistant calling. May I speak with ${input.leadName}?`, timestamp: new Date().toISOString() },
        { speaker: "human" as const, text: "Speaking, who is this?", timestamp: new Date(Date.now() + 2000).toISOString() },
        { speaker: "ai" as const, text: "Thank you for your time. I'm calling regarding our services. Are you interested in learning more?", timestamp: new Date(Date.now() + 4000).toISOString() },
      ];

      const id = await createAIConversation({
        agentId: input.agentId,
        leadId: input.leadId,
        transcript: mockTranscript,
        sentiment: "neutral",
        duration: 15,
      });

      return {
        id,
        transcript: mockTranscript,
        status: "completed",
        sentiment: "neutral",
        duration: 15,
        success: true,
      };
    }),
});
