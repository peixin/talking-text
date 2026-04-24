import { ChatClient } from "./ChatClient";

export default async function ChatPage() {
  const initialHistory: { role: "user" | "assistant"; text: string }[] = [];
  return <ChatClient initialHistory={initialHistory} />;
}
