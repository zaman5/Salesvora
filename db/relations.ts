import { relations } from "drizzle-orm";
import {
  companies,
  users,
  leadLists,
  leads,
  campaigns,
  campaignLeads,
  calls,
  aiAgents,
  aiConversations,
  smsCampaigns,
  smsLogs,
} from "./schema";

// ─── Company Relations ───
export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users),
  leadLists: many(leadLists),
  leads: many(leads),
  campaigns: many(campaigns),
  aiAgents: many(aiAgents),
  smsCampaigns: many(smsCampaigns),
}));

// ─── User Relations ───
export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  createdUsers: many(users, { relationName: "createdBy" }),
  creator: one(users, { fields: [users.createdBy], references: [users.id], relationName: "createdBy" }),
}));

// ─── Lead List Relations ───
export const leadListsRelations = relations(leadLists, ({ one, many }) => ({
  company: one(companies, { fields: [leadLists.companyId], references: [companies.id] }),
  leads: many(leads),
  campaigns: many(campaigns),
}));

// ─── Lead Relations ───
export const leadsRelations = relations(leads, ({ one, many }) => ({
  leadList: one(leadLists, { fields: [leads.leadListId], references: [leadLists.id] }),
  company: one(companies, { fields: [leads.companyId], references: [companies.id] }),
  calls: many(calls),
  campaignLeads: many(campaignLeads),
}));

// ─── Campaign Relations ───
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  company: one(companies, { fields: [campaigns.companyId], references: [companies.id] }),
  leadList: one(leadLists, { fields: [campaigns.leadListId], references: [leadLists.id] }),
  campaignLeads: many(campaignLeads),
  calls: many(calls),
}));

// ─── Campaign Lead Relations ───
export const campaignLeadsRelations = relations(campaignLeads, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignLeads.campaignId], references: [campaigns.id] }),
  lead: one(leads, { fields: [campaignLeads.leadId], references: [leads.id] }),
}));

// ─── Call Relations ───
export const callsRelations = relations(calls, ({ one }) => ({
  caller: one(users, { fields: [calls.callerId], references: [users.id] }),
  lead: one(leads, { fields: [calls.leadId], references: [leads.id] }),
  campaign: one(campaigns, { fields: [calls.campaignId], references: [campaigns.id] }),
  company: one(companies, { fields: [calls.companyId], references: [companies.id] }),
}));

// ─── AI Agent Relations ───
export const aiAgentsRelations = relations(aiAgents, ({ one, many }) => ({
  company: one(companies, { fields: [aiAgents.companyId], references: [companies.id] }),
  conversations: many(aiConversations),
}));

// ─── AI Conversation Relations ───
export const aiConversationsRelations = relations(aiConversations, ({ one }) => ({
  agent: one(aiAgents, { fields: [aiConversations.agentId], references: [aiAgents.id] }),
  lead: one(leads, { fields: [aiConversations.leadId], references: [leads.id] }),
}));

// ─── SMS Campaign Relations ───
export const smsCampaignsRelations = relations(smsCampaigns, ({ one, many }) => ({
  company: one(companies, { fields: [smsCampaigns.companyId], references: [companies.id] }),
  logs: many(smsLogs),
}));
