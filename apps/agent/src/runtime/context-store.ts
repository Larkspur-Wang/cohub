import { db } from "../db.js";
import { readTurnObjectJson } from "../turn-object-storage.js";
import { logger } from "../logger.js";
import { createRuntimeContextReader } from "./context-reader.js";

export const loadRuntimeContext = createRuntimeContextReader(db, readTurnObjectJson, (turnId, error) => {
  logger.warn("[RuntimeContext] native archive unavailable; using durable message history", { turnId, error });
});
