import { redirect } from "next/navigation";
import ChatList, { loadChats } from "@/components/ChatList";

// Opening a project opens its newest chat (beside the list). "?list=1" is the
// phone's All Chats view: just the list.
export default async function ProjectHome({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ list?: string }> }) {
  const { id } = await params;
  const { list } = await searchParams;
  const data = await loadChats(id);
  if (data.first && !list) redirect(`/projects/${id}/chats/${data.first.id}`);
  return (
    <div className="chat home">
      <ChatList projectId={id} data={data} />
      <div className="chat-pane chat-none empty">{data.first ? "Choose a chat." : "No chats yet."}</div>
    </div>
  );
}
