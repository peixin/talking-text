"use server";

// Forwarded to the session-scoped route. This file is kept for reference only.
export { createSession, renameSession, deleteSession, setActiveLearner, sendTurn } from "./[sessionId]/actions";
export type { Message, SendTurnResult } from "./[sessionId]/actions";
