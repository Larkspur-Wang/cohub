export const SESSION_MESSAGE_POSTPROCESS_JOB = "session.message.postprocess";

export type SessionMessagePostprocessJobData = {
  sessionId: string;
  messageId: string;
  trace?: Record<string, unknown>;
};

export const buildSessionMessagePostprocessJobId = (messageId: string) =>
  `session-message-postprocess-${messageId}`;
