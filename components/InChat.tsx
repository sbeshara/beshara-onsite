"use client";

import { usePathname } from "next/navigation";

// Inside one chat the project header gets out of the way: the phase bar is
// hidden (a small phase label shows instead) so the conversation has room.
const inChat = (path: string) => /\/projects\/[^/]+\/chats\/[^/]+/.test(path);

export function HideInChat({ children }: { children: React.ReactNode }) {
  return inChat(usePathname()) ? null : <>{children}</>;
}

export function OnlyInChat({ children }: { children: React.ReactNode }) {
  return inChat(usePathname()) ? <>{children}</> : null;
}
