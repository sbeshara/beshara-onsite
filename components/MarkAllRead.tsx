"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllRead } from "@/app/actions";

// "Mark All as Read": clears your unread dots and counts in one tap, for every
// project or just one.
export default function MarkAllRead({ projectId, className = "linkbtn" }: { projectId?: string; className?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className={`${className} mark-read`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllRead(projectId);
          router.refresh();
        })
      }
    >
      {pending ? "Marking…" : "Mark All as Read"}
    </button>
  );
}
