// Your settings and the workspace's, as the server would hold them. UI-only:
// saving updates this object, standing in for the API call.
export const settings = {
  name: "Johan Gafaro",
  notifyMentions: true,
  notifyQuestions: true,
  notifyFailures: true,
  notifyAssignments: true,
  model: "gpt-5.5" as "gpt-5.5" | "gpt-5.5-mini",
  workspaceName: "Hello Gafaro",
};

export type Settings = typeof settings;

// Workspace members' roles (the owner's is fixed).
export const memberRoles: Record<string, "admin" | "member"> = {
  u_maya: "member",
};

export function saveSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
) {
  settings[key] = value;
}

// Skills and connections an agent may be given (Agent is the one place they
// are granted), and each agent's configuration. UI-only for now.
export const skills = [
  {
    id: "sk_review",
    title: "Code review",
    description: "Reviews a change against its task before it ships.",
  },
  {
    id: "sk_release",
    title: "Release notes",
    description: "Writes release notes from merged changes.",
  },
  {
    id: "sk_research",
    title: "Web research",
    description: "Searches, reads and compares sources, with links.",
  },
  {
    id: "sk_pricing",
    title: "Pricing scan",
    description: "Compares competitors' plans and prices.",
  },
  {
    id: "sk_voice",
    title: "Brand voice",
    description: "Writes in Hello Gafaro's voice and style.",
  },
  {
    id: "sk_seo",
    title: "SEO audit",
    description: "Checks pages for titles, links and speed.",
  },
  {
    id: "sk_notes",
    title: "Meeting notes",
    description: "Turns a call into decisions and tasks.",
  },
  {
    id: "sk_data",
    title: "Data analysis",
    description: "Reads sheets and exports and charts what changed.",
  },
];

export const connections = [
  { id: "cn_github", title: "GitHub", description: "johan-gafaro" },
  { id: "cn_notion", title: "Notion", description: "MCP server" },
];

export type AgentModel = "default" | "gpt-5.5" | "gpt-5.5-mini";

export type AgentConfig = {
  instructions: string;
  model: AgentModel;
  visibility: "user" | "workspace";
  skillIds: string[];
  connectionIds: string[];
};

export const agentConfigs: Record<string, AgentConfig> = {
  a_otto: {
    instructions:
      "You run the work: read the request, split it into tasks, hand each to the agent that owns it and follow up until it is done. Ask before anything outward-facing.",
    model: "default",
    visibility: "workspace",
    skillIds: ["sk_notes", "sk_research"],
    connectionIds: ["cn_notion"],
  },
  a_forge: {
    instructions:
      "Make the smallest correct change, run the checks, and say what you verified.",
    model: "gpt-5.5",
    visibility: "workspace",
    skillIds: ["sk_review", "sk_release"],
    connectionIds: ["cn_github"],
  },
  a_scout: {
    instructions:
      'Cite every claim with a link. Say "likely" when the evidence is indirect.',
    model: "gpt-5.5-mini",
    visibility: "workspace",
    skillIds: ["sk_research", "sk_pricing", "sk_seo"],
    connectionIds: [],
  },
  a_quill: {
    instructions: "Plain, warm, short. Sentence case. No jargon.",
    model: "default",
    visibility: "user",
    skillIds: ["sk_voice"],
    connectionIds: ["cn_notion"],
  },
};
