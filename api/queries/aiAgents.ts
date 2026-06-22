import { getDb } from "./connection";
import { aiAgents, aiConversations } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

const dbJsonPath = path.resolve(process.cwd(), "db.json");

function readJsonDb() {
  if (!fs.existsSync(dbJsonPath)) {
    const initialData = { users: [], companies: [], leadLists: [], leads: [], leadListAssignments: [], campaigns: [], campaignLeads: [], calls: [], smsCampaigns: [], smsLogs: [], aiAgents: [] };
    fs.writeFileSync(dbJsonPath, JSON.stringify(initialData, null, 2), "utf-8");
    return initialData;
  }
  try {
    const content = fs.readFileSync(dbJsonPath, "utf-8");
    const data = JSON.parse(content);
    let modified = false;
    for (const key of ["users", "companies", "leadLists", "leads", "leadListAssignments", "campaigns", "campaignLeads", "calls", "smsCampaigns", "smsLogs", "aiAgents", "aiConversations"]) {
      if (!data[key]) {
        data[key] = [];
        modified = true;
      }
    }
    
    // Seed initial mock AI agent if empty
    if (data.aiAgents.length === 0) {
      data.aiAgents = [
        { id: 1, name: "Sales Outreach Bot", companyId: 1, voice: "alloy", language: "en", greeting: "Hello, my name is Alex. How are you today?", systemPrompt: "You are a professional sales agent outreach assistant.", isActive: true, createdBy: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      modified = true;
    }
    if (data.aiConversations.length === 0) {
      data.aiConversations = [
        { id: 1, agentId: 1, leadId: 1, campaignId: 1, callId: 1, transcript: [{ speaker: "ai", text: "Hello, my name is Alex. How are you today?", timestamp: new Date().toISOString() }, { speaker: "human", text: "Hello, yes I am doing good. Who is this?", timestamp: new Date().toISOString() }], sentiment: "positive", duration: 15, outcome: "Interested", recordingUrl: "https://example.com/recording.mp3", createdAt: new Date().toISOString() }
      ];
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
    }
    return data;
  } catch (err) {
    console.error("Failed to parse db.json, returning empty structure:", err);
    return { users: [], companies: [], leadLists: [], leads: [], leadListAssignments: [], campaigns: [], campaignLeads: [], calls: [], smsCampaigns: [], smsLogs: [], aiAgents: [], aiConversations: [] };
  }
}

function writeJsonDb(data: any) {
  try {
    fs.writeFileSync(dbJsonPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to db.json:", err);
  }
}

export async function findAIAgentsByCompany(companyId?: number) {
  try {
    return await getDb().query.aiAgents.findMany({
      where: companyId === undefined ? undefined : eq(aiAgents.companyId, companyId),
      orderBy: [desc(aiAgents.createdAt)],
    });
  } catch {
    console.warn("[findAIAgentsByCompany] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.aiAgents
      .filter((a: any) => companyId === undefined || a.companyId == companyId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function findAIAgentById(id: number) {
  try {
    return await getDb().query.aiAgents.findFirst({
      where: eq(aiAgents.id, id),
    });
  } catch {
    console.warn("[findAIAgentById] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.aiAgents.find((a: any) => a.id == id) || null;
  }
}

export async function createAIAgent(data: {
  name: string; companyId: number; voice: string; language: string;
  greeting?: string; systemPrompt?: string; script?: any;
  maxRetries: number; timeoutSeconds: number; isActive: boolean; createdBy: number;
  // Voice / TTS provider
  voiceProvider?: string; voiceId?: string; ttsModel?: string;
  // Human voice cloning (mic recording or uploaded audio sample)
  voiceCloneName?: string; voiceCloneSample?: string;
  // Latency + knowledge base
  latencyMode?: string;
  knowledgeBase?: Array<{ id: string; title: string; content: string }>;
}) {
  try {
    const result = await getDb().insert(aiAgents).values({
      ...data,
      voice: data.voice as any,
      voiceProvider: (data.voiceProvider || "openai") as any,
      latencyMode: (data.latencyMode || "low") as any,
    }).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createAIAgent] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newAgent = {
      id,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    store.aiAgents.push(newAgent);
    writeJsonDb(store);
    return id;
  }
}

export async function updateAIAgent(id: number, data: Partial<{
  name: string; voice: string; language: string; greeting: string; systemPrompt: string;
  script: any; maxRetries: number; timeoutSeconds: number; isActive: boolean;
  voiceProvider: string; voiceId: string; ttsModel: string;
  voiceCloneName: string; voiceCloneSample: string;
  latencyMode: string;
  knowledgeBase: Array<{ id: string; title: string; content: string }>;
}>) {
  try {
    await getDb().update(aiAgents).set(data as any).where(eq(aiAgents.id, id));
  } catch {
    console.warn("[updateAIAgent] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.aiAgents.findIndex((a: any) => a.id == id);
    if (idx !== -1) {
      store.aiAgents[idx] = {
        ...store.aiAgents[idx],
        ...data,
        updatedAt: new Date().toISOString()
      };
      writeJsonDb(store);
    }
  }
}

export async function deleteAIAgent(id: number) {
  try {
    await getDb().update(aiAgents).set({ isActive: false }).where(eq(aiAgents.id, id));
  } catch {
    console.warn("[deleteAIAgent] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.aiAgents.findIndex((a: any) => a.id == id);
    if (idx !== -1) {
      store.aiAgents[idx].isActive = false;
      store.aiAgents[idx].updatedAt = new Date().toISOString();
      writeJsonDb(store);
    }
  }
}

// ─── AI Conversations ───
export async function findConversationsByAgent(agentId: number) {
  try {
    return await getDb().query.aiConversations.findMany({
      where: eq(aiConversations.agentId, agentId),
      orderBy: [desc(aiConversations.createdAt)],
    });
  } catch {
    console.warn("[findConversationsByAgent] DB offline, falling back to local JSON store.");
    const data = readJsonDb();
    return data.aiConversations
      .filter((c: any) => c.agentId == agentId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export async function createAIConversation(data: { agentId: number; leadId: number; campaignId?: number; callId?: number; transcript?: any[]; sentiment?: string; duration?: number; outcome?: string; recordingUrl?: string }) {
  try {
    const result = await getDb().insert(aiConversations).values({
      ...data,
      transcript: data.transcript || [],
      sentiment: (data.sentiment || "neutral") as any,
      duration: data.duration || 0,
    }).$returningId();
    return result[0]?.id;
  } catch {
    console.warn("[createAIConversation] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const id = Date.now();
    const newConv = {
      id,
      ...data,
      transcript: data.transcript || [],
      sentiment: data.sentiment || "neutral",
      duration: data.duration || 0,
      createdAt: new Date().toISOString()
    };
    store.aiConversations.push(newConv);
    writeJsonDb(store);
    return id;
  }
}

export async function updateConversationTranscript(id: number, transcript: any[], sentiment?: string, outcome?: string) {
  try {
    await getDb().update(aiConversations)
      .set({ transcript, sentiment: sentiment as any, outcome })
      .where(eq(aiConversations.id, id));
  } catch {
    console.warn("[updateConversationTranscript] DB offline, falling back to local JSON store.");
    const store = readJsonDb();
    const idx = store.aiConversations.findIndex((c: any) => c.id == id);
    if (idx !== -1) {
      store.aiConversations[idx].transcript = transcript;
      if (sentiment) store.aiConversations[idx].sentiment = sentiment;
      if (outcome) store.aiConversations[idx].outcome = outcome;
      writeJsonDb(store);
    }
  }
}
