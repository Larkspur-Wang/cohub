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
  constructor(message = "Generation provider request failed") {
    super(502, "provider_request_failed", message);
    this.name = "GenerationProviderError";
  }
}
