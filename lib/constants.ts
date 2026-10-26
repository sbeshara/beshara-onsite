export const PHASES = ["Preconstruction", "Permits", "Construction", "Punch list", "Closeout"] as const;

export const FOLDERS = ["Drawings", "Submittals", "Permits & inspections", "Photos", "Contracts"] as const;
export type Folder = (typeof FOLDERS)[number];

export const ROLE_LABEL = {
  owner: "Principal Contractor",
  admin: "Admin",
  construction: "Construction Management",
  client: "Client",
} as const;

export const FILES_BUCKET = "project-files";

// What to show under someone's name: a client's own title, or the team role.
export function roleLabel(p: { role: keyof typeof ROLE_LABEL; title: string | null }) {
  return p.role === "client" ? p.title || "Client" : ROLE_LABEL[p.role];
}
