export interface Workspace {
  id: string;
  name: string;
  description: string;
  image?: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  personality?: string;
}

export interface Session {
  id: string;
  workspaceId: string;
  agentId: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
