export type GenerationProviderErrorDetails = {
  status?: number;
  body?: string;
  taskId?: string;
};

export class GenerationHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GenerationHttpError";
  }
}

export class GenerationProviderError extends GenerationHttpError {
  constructor(
    message = "Generation provider request failed",
    public readonly provider?: GenerationProviderErrorDetails,
  ) {
    super(502, "provider_request_failed", message);
    this.name = "GenerationProviderError";
  }
}
