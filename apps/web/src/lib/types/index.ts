export interface World {
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
    worldId: string;
    agentId: string;
    title: string;
    status: 'active' | 'archived';
    createdAt: string;
}

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt: string;
}
