"use client";

import { usePathname, useRouter } from "next/navigation";

type P = { id: string; name: string; town: string };

// Phone-width navigation: the side menu becomes this dropdown.
export default function ProjectSwitcher({ projects, isClient, isAdmin }: { projects: P[]; isClient: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const current =
    projects.find((p) => path.startsWith(`/projects/${p.id}`))?.id ??
    (["/team", "/projects/new", "/account"].includes(path) ? path : "/");

  function go(value: string) {
    if (value === "signout") {
      const form = document.getElementById("signout-form") as HTMLFormElement | null;
      form?.requestSubmit();
      return;
    }
    router.push(value.startsWith("/") ? value : `/projects/${value}`);
  }

  return (
    <select className="proj-select" aria-label="Go to" value={current} onChange={(e) => go(e.target.value)}>
      <option value="/">{isClient ? "Home" : "Dashboard"}</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
          {p.town ? ` · ${p.town}` : ""}
        </option>
      ))}
      {isAdmin && <option value="/projects/new">+ New project</option>}
      {isAdmin && <option value="/team">Team &amp; access</option>}
      <option value="/account">Your account</option>
      <option value="signout">Sign out</option>
    </select>
  );
}
