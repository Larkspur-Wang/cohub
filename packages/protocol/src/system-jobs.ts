export const SESSION_MESSAGE_POSTPROCESS_JOB = "session.message.postprocess";

export type SessionMessagePostprocessJobData = {
  sessionId: string;
  messageId: string;
  trace?: Record<string, unknown>;
};
