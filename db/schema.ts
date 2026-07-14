import {
  mysqlTable,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  mysqlEnum,
  json,
  boolean,
  index,
} from "drizzle-orm/mysql-core";

// ─── Companies (Multi-tenant support) ───
export const companies = mysqlTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  website: varchar("website", { length: 255 }),
  industry: varchar("industry", { length: 100 }),
  customFields: json("custom_fields").$type<Record<string, string>>(),
  settings: json("settings").$type<Record<string, any>>(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

// ─── Users (Admin + Callers/Agents) ───
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  phone: varchar("phone", { length: 50 }),
  role: mysqlEnum("role", ["superadmin", "admin", "caller", "viewer"]).default("caller").notNull(),
  status: mysqlEnum("status", ["active", "inactive", "suspended"]).default("active").notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  extension: varchar("extension", { length: 20 }),
  sipCredentials: json("sip_credentials").$type<{ username: string; password: string; domain: string }>(),
  dailyCallLimit: int("daily_call_limit").default(200),
  permissions: json("permissions").$type<string[]>(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  companyIdx: index("company_idx").on(table.companyId),
  roleIdx: index("role_idx").on(table.role),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Lead Lists ───
export const leadLists = mysqlTable("lead_lists", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  totalLeads: int("total_leads").default(0).notNull(),
  calledLeads: int("called_leads").default(0).notNull(),
  customFieldSchema: json("custom_field_schema").$type<Array<{ name: string; type: string; required?: boolean }>>(),
  status: mysqlEnum("status", ["active", "inactive", "archived"]).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  companyIdx: index("ll_company_idx").on(table.companyId),
}));

export type LeadList = typeof leadLists.$inferSelect;
export type InsertLeadList = typeof leadLists.$inferInsert;

// ─── Lead List Assignments (to callers) ───
export const leadListAssignments = mysqlTable("lead_list_assignments", {
  id: serial("id").primaryKey(),
  leadListId: bigint("lead_list_id", { mode: "number", unsigned: true }).notNull(),
  callerId: bigint("caller_id", { mode: "number", unsigned: true }).notNull(),
  assignedBy: bigint("assigned_by", { mode: "number", unsigned: true }).notNull(),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => ({
  listIdx: index("lla_list_idx").on(table.leadListId),
  callerIdx: index("lla_caller_idx").on(table.callerId),
}));

export type LeadListAssignment = typeof leadListAssignments.$inferSelect;

// ─── Leads ───
export const leads = mysqlTable("leads", {
  id: serial("id").primaryKey(),
  leadListId: bigint("lead_list_id", { mode: "number", unsigned: true }).notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  companyName: varchar("company_name", { length: 255 }),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  phone: varchar("phone", { length: 50 }).notNull(),
  phone2: varchar("phone2", { length: 50 }),
  email: varchar("email", { length: 320 }),
  designation: varchar("designation", { length: 255 }),
  address: text("address"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  country: varchar("country", { length: 100 }),
  zipCode: varchar("zip_code", { length: 20 }),
  website: varchar("website", { length: 255 }),
  customFields: json("custom_fields").$type<Record<string, any>>(),
  status: mysqlEnum("status", ["new", "contacted", "qualified", "converted", "unqualified", "callback", "dnc"]).default("new").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  notes: text("notes"),
  assignedTo: bigint("assigned_to", { mode: "number", unsigned: true }),
  callCount: int("call_count").default(0).notNull(),
  lastCalledAt: timestamp("last_called_at"),
  nextCallbackAt: timestamp("next_callback_at"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  listIdx: index("leads_list_idx").on(table.leadListId),
  companyIdx: index("leads_company_idx").on(table.companyId),
  phoneIdx: index("leads_phone_idx").on(table.phone),
  assignedIdx: index("leads_assigned_idx").on(table.assignedTo),
  statusIdx: index("leads_status_idx").on(table.status),
}));

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

// ─── Campaigns ───
export const campaigns = mysqlTable("campaigns", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  type: mysqlEnum("type", ["manual", "auto", "ai", "sms"]).notNull(),
  status: mysqlEnum("status", ["draft", "running", "paused", "completed", "scheduled"]).default("draft").notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  leadListId: bigint("lead_list_id", { mode: "number", unsigned: true }).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  assignedCallers: json("assigned_callers").$type<number[]>(),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  dailyStartTime: varchar("daily_start_time", { length: 10 }).default("09:00"),
  dailyEndTime: varchar("daily_end_time", { length: 10 }).default("18:00"),
  timezone: varchar("timezone", { length: 50 }).default("UTC"),
  callDelay: int("call_delay").default(5),
  maxAttempts: int("max_attempts").default(3),
  totalLeads: int("total_leads").default(0).notNull(),
  completedLeads: int("completed_leads").default(0).notNull(),
  successfulCalls: int("successful_calls").default(0).notNull(),
  failedCalls: int("failed_calls").default(0).notNull(),
  settings: json("settings").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  companyIdx: index("camp_company_idx").on(table.companyId),
  statusIdx: index("camp_status_idx").on(table.status),
  typeIdx: index("camp_type_idx").on(table.type),
}));

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

// ─── Campaign Leads (junction + progress tracking) ───
export const campaignLeads = mysqlTable("campaign_leads", {
  id: serial("id").primaryKey(),
  campaignId: bigint("campaign_id", { mode: "number", unsigned: true }).notNull(),
  leadId: bigint("lead_id", { mode: "number", unsigned: true }).notNull(),
  callerId: bigint("caller_id", { mode: "number", unsigned: true }),
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "failed", "skipped", "callback"]).default("pending").notNull(),
  attemptCount: int("attempt_count").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  completedAt: timestamp("completed_at"),
  sequenceOrder: int("sequence_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  campaignIdx: index("cl_campaign_idx").on(table.campaignId),
  leadIdx: index("cl_lead_idx").on(table.leadId),
  callerIdx: index("cl_caller_idx").on(table.callerId),
  statusIdx: index("cl_status_idx").on(table.status),
}));

export type CampaignLead = typeof campaignLeads.$inferSelect;
export type InsertCampaignLead = typeof campaignLeads.$inferInsert;

// ─── Call Dispositions (outcomes) ───
export const callDispositions = mysqlTable("call_dispositions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  category: mysqlEnum("category", ["connected", "no_answer", "voicemail", "machine", "wrong_number", "not_interested", "callback", "converted", "dnc", "custom"]).notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }),
  isSystem: boolean("is_system").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  color: varchar("color", { length: 20 }).default("#6B7280"),
  order: int("order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CallDisposition = typeof callDispositions.$inferSelect;

// ─── Calls ───
export const calls = mysqlTable("calls", {
  id: serial("id").primaryKey(),
  callSid: varchar("call_sid", { length: 255 }).unique(),
  callerId: bigint("caller_id", { mode: "number", unsigned: true }).notNull(),
  adminId: bigint("admin_id", { mode: "number", unsigned: true }),
  leadId: bigint("lead_id", { mode: "number", unsigned: true }),
  campaignId: bigint("campaign_id", { mode: "number", unsigned: true }),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["manual", "auto", "ai", "inbound"]).notNull(),
  direction: mysqlEnum("direction", ["outbound", "inbound"]).default("outbound").notNull(),
  status: mysqlEnum("status", ["initiated", "ringing", "connected", "completed", "failed", "no_answer", "busy", "cancelled"]).default("initiated").notNull(),
  dispositionId: bigint("disposition_id", { mode: "number", unsigned: true }),
  duration: int("duration").default(0),
  fromNumber: varchar("from_number", { length: 50 }),
  toNumber: varchar("to_number", { length: 50 }).notNull(),
  recordingUrl: text("recording_url"),
  recordingDuration: int("recording_duration"),
  notes: text("notes"),
  callDescription: text("call_description"),
  customFields: json("custom_fields").$type<Record<string, any>>(),
  startedAt: timestamp("started_at"),
  answeredAt: timestamp("answered_at"),
  endedAt: timestamp("ended_at"),
  // Updated periodically by the caller's browser while the call is live so
  // stale "connected" rows (crashed tab, lost network) can be detected and
  // auto-completed instead of showing as live forever.
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  callerIdx: index("calls_caller_idx").on(table.callerId),
  leadIdx: index("calls_lead_idx").on(table.leadId),
  campaignIdx: index("calls_campaign_idx").on(table.campaignId),
  companyIdx: index("calls_company_idx").on(table.companyId),
  statusIdx: index("calls_status_idx").on(table.status),
  createdIdx: index("calls_created_idx").on(table.createdAt),
}));

export type Call = typeof calls.$inferSelect;
export type InsertCall = typeof calls.$inferInsert;

// ─── Live Monitor Sessions ───
export const liveMonitorSessions = mysqlTable("live_monitor_sessions", {
  id: serial("id").primaryKey(),
  adminId: bigint("admin_id", { mode: "number", unsigned: true }).notNull(),
  callerId: bigint("caller_id", { mode: "number", unsigned: true }).notNull(),
  callId: bigint("call_id", { mode: "number", unsigned: true }).notNull(),
  monitorChannel: varchar("monitor_channel", { length: 255 }),
  status: mysqlEnum("status", ["listening", "ended", "failed"]).default("listening").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
}, (table) => ({
  adminIdx: index("lms_admin_idx").on(table.adminId),
  callerIdx: index("lms_caller_idx").on(table.callerId),
}));

export type LiveMonitorSession = typeof liveMonitorSessions.$inferSelect;

// ─── AI Agents ───
export const aiAgents = mysqlTable("ai_agents", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  voice: mysqlEnum("voice", ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]).default("alloy").notNull(),
  // ── Voice / TTS Provider ──
  voiceProvider: mysqlEnum("voice_provider", ["openai", "elevenlabs", "cartesia", "voice_clone"]).default("openai").notNull(),
  voiceId: varchar("voice_id", { length: 255 }),
  ttsModel: varchar("tts_model", { length: 100 }),
  // ── Human Voice Cloning (mimicking) ──
  voiceCloneName: varchar("voice_clone_name", { length: 255 }),
  voiceCloneSample: text("voice_clone_sample"),
  // ── Latency Optimization ──
  latencyMode: mysqlEnum("latency_mode", ["ultra_low", "low", "balanced", "quality"]).default("low").notNull(),
  // ── Knowledge Base ──
  knowledgeBase: json("knowledge_base").$type<Array<{ id: string; title: string; content: string }>>(),
  language: varchar("language", { length: 10 }).default("en").notNull(),
  greeting: text("greeting"),
  systemPrompt: text("system_prompt"),
  script: json("script").$type<Array<{ step: number; message: string; expectedResponse?: string; action?: string }>>(),
  maxRetries: int("max_retries").default(2),
  timeoutSeconds: int("timeout_seconds").default(30),
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type AIAgent = typeof aiAgents.$inferSelect;

// ─── AI Conversations ───
export const aiConversations = mysqlTable("ai_conversations", {
  id: serial("id").primaryKey(),
  agentId: bigint("agent_id", { mode: "number", unsigned: true }).notNull(),
  leadId: bigint("lead_id", { mode: "number", unsigned: true }).notNull(),
  campaignId: bigint("campaign_id", { mode: "number", unsigned: true }),
  callId: bigint("call_id", { mode: "number", unsigned: true }),
  transcript: json("transcript").$type<Array<{ speaker: "ai" | "human"; text: string; timestamp: string }>>(),
  sentiment: mysqlEnum("sentiment", ["positive", "neutral", "negative"]).default("neutral"),
  outcome: varchar("outcome", { length: 100 }),
  recordingUrl: text("recording_url"),
  duration: int("duration").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AIConversation = typeof aiConversations.$inferSelect;

// ─── SMS Campaigns ───
export const smsCampaigns = mysqlTable("sms_campaigns", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  companyId: bigint("company_id", { mode: "number", unsigned: true }).notNull(),
  leadListId: bigint("lead_list_id", { mode: "number", unsigned: true }).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }).notNull(),
  messageTemplate: text("message_template").notNull(),
  fromNumber: varchar("from_number", { length: 50 }),
  status: mysqlEnum("status", ["draft", "scheduled", "sending", "completed", "paused"]).default("draft").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  totalMessages: int("total_messages").default(0).notNull(),
  sentMessages: int("sent_messages").default(0).notNull(),
  failedMessages: int("failed_messages").default(0).notNull(),
  deliveredMessages: int("delivered_messages").default(0).notNull(),
  repliedMessages: int("replied_messages").default(0).notNull(),
  settings: json("settings").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
});

export type SMSCampaign = typeof smsCampaigns.$inferSelect;

// ─── SMS Logs ───
export const smsLogs = mysqlTable("sms_logs", {
  id: serial("id").primaryKey(),
  // Nullable: inbound messages and one-off sendDirect messages have no campaign.
  smsCampaignId: bigint("sms_campaign_id", { mode: "number", unsigned: true }),
  leadId: bigint("lead_id", { mode: "number", unsigned: true }),
  companyId: bigint("company_id", { mode: "number", unsigned: true }),
  direction: mysqlEnum("direction", ["outbound", "inbound"]).default("outbound").notNull(),
  toNumber: varchar("to_number", { length: 50 }).notNull(),
  fromNumber: varchar("from_number", { length: 50 }),
  message: text("message").notNull(),
  status: mysqlEnum("status", ["pending", "sent", "delivered", "failed", "replied", "received"]).default("pending").notNull(),
  twilioSid: varchar("twilio_sid", { length: 255 }),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  companyIdx: index("sms_company_idx").on(table.companyId),
  toNumberIdx: index("sms_to_number_idx").on(table.toNumber),
  fromNumberIdx: index("sms_from_number_idx").on(table.fromNumber),
}));

export type SMSLog = typeof smsLogs.$inferSelect;

// ─── Audit Logs ───
export const auditLogs = mysqlTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  companyId: bigint("company_id", { mode: "number", unsigned: true }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: bigint("entity_id", { mode: "number", unsigned: true }),
  oldValues: json("old_values").$type<Record<string, any>>(),
  newValues: json("new_values").$type<Record<string, any>>(),
  ipAddress: varchar("ip_address", { length: 50 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("al_user_idx").on(table.userId),
  companyIdx: index("al_company_idx").on(table.companyId),
  createdIdx: index("al_created_idx").on(table.createdAt),
}));

export type AuditLog = typeof auditLogs.$inferSelect;

// ─── Call Recordings ───
export const callRecordings = mysqlTable("call_recordings", {
  id: serial("id").primaryKey(),
  callId: bigint("call_id", { mode: "number", unsigned: true }).notNull(),
  recordingUrl: text("recording_url").notNull(),
  duration: int("duration").default(0),
  fileSize: bigint("file_size", { mode: "number", unsigned: true }),
  format: varchar("format", { length: 20 }).default("mp3"),
  status: mysqlEnum("status", ["recording", "completed", "failed"]).default("recording").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CallRecording = typeof callRecordings.$inferSelect;
export type InsertCallRecording = typeof callRecordings.$inferInsert;

// ─── Insert Types ───
export type InsertCallDisposition = typeof callDispositions.$inferInsert;
export type InsertLiveMonitorSession = typeof liveMonitorSessions.$inferInsert;
export type InsertAIAgent = typeof aiAgents.$inferInsert;
export type InsertAIConversation = typeof aiConversations.$inferInsert;
export type InsertSMSCampaign = typeof smsCampaigns.$inferInsert;
export type InsertSMSLog = typeof smsLogs.$inferInsert;
export type InsertLeadListAssignment = typeof leadListAssignments.$inferInsert;
