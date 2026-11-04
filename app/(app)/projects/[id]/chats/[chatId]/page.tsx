import ChatList from "@/components/ChatList";
import ChatView from "@/components/ChatView";

// Chats on the left, the open chat on the right (on a phone, just the chat).
export default async function ChatPage({ params }: { params: Promise<{ id: string; chatId: string }> }) {
  const { id, chatId } = await params;
  return (
    <div className="chat">
      <ChatList projectId={id} activeId={chatId} />
      <ChatView projectId={id} chatId={chatId} />
    </div>
  );
}
