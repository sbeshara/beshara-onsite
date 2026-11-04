import ChatList, { loadChats } from "@/components/ChatList";
import ChatView from "@/components/ChatView";

// Opening a project shows its chats with the newest one open beside them.
// On a phone it shows just the list.
export default async function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadChats(id);
  return (
    <div className="chat home">
      <ChatList projectId={id} activeId={data.first?.id} data={data} />
      {data.first ? <ChatView projectId={id} chatId={data.first.id} /> : <div className="chat-pane chat-none empty">No chats yet.</div>}
    </div>
  );
}
