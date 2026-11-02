import ChatList from "@/components/ChatList";

// Opening a project shows its chats; each chat opens on its own page.
export default async function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatList projectId={id} />;
}
