export type GenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; media_type: string; data: string }
  | { type: "space_file"; space_id: string; path: string };

export type GenerationContentBlockMeta = Record<string, unknown>;

export type GenerationContentBlock =
  | { type: "text"; text: string; _meta?: GenerationContentBlockMeta }
  | { type: "image"; source: GenerationSource; _meta?: GenerationContentBlockMeta }
  | { type: "video"; source: GenerationSource; _meta?: GenerationContentBlockMeta }
  | { type: "audio"; source: GenerationSource; _meta?: GenerationContentBlockMeta };

export type GenerationContentSpec = {
  type: "text" | "image" | "video" | "audio";
  required?: boolean;
  min?: number;
  max?: number;
  sources?: Array<"url" | "base64" | "space_file">;
  merge?: "newline" | "space" | "concat";
  meta?: Record<string, unknown>;
  description?: string;
};

export type GenerationParameterSpec =
  | {
      type: "string";
      optional?: boolean;
      default?: string;
      enum?: string[];
      description?: string;
      examples?: string[];
    }
  | {
      type: "number";
      optional?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
      examples?: number[];
    }
  | {
      type: "integer";
      optional?: boolean;
      default?: number;
      min?: number;
      max?: number;
      description?: string;
      examples?: number[];
    }
  | {
      type: "boolean";
      optional?: boolean;
      default?: boolean;
      description?: string;
      examples?: boolean[];
    };

export const GENERATION_TASK_TYPE = "generation" as const;

export type CreateGenerationTaskRequest = {
  spaceId: string;
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type CreateGenerationTaskResponse = {
  taskRunId: string;
  taskType: typeof GENERATION_TASK_TYPE;
  status: "pending";
};

export type GenerationTaskData = {
  model: string;
  content: GenerationContentBlock[];
  parameters?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type GenerationTaskResult = {
  model: string;
  output: GenerationContentBlock[];
  metadata?: Record<string, unknown>;
};

export type GenerationExampleRequest = Omit<CreateGenerationTaskRequest, "spaceId">;

export type GenerationDeclaration = {
  schema: "cohub.generation.v1";
  model: string;
  title?: string;
  description?: string;
  adapter: {
    type: string;
    base_url: string;
    api_key: string;
  };
  content: {
    input: GenerationContentSpec[];
  };
  parameters?: Record<string, GenerationParameterSpec>;
  examples?: Array<{
    title?: string;
    request: GenerationExampleRequest;
  }>;
};

export type PublicGenerationDeclaration = Omit<GenerationDeclaration, "adapter">;

export type ListGenerationModelsResponse = {
  models: PublicGenerationDeclaration[];
};
