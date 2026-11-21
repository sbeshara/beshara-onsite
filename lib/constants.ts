// What clients see: the project's stage. Indexes match projects.phase in the
// database; 3 (Punch List) is no longer used, it's part of Construction.
export const PHASES = ["Preconstruction", "Permits", "Construction", "Punch List", "Closeout"] as const;
export const STAGES = [0, 1, 2, 4] as const; // the phases shown, in order
export const stageNumber = (phase: number) => Math.max(0, STAGES.indexOf((phase === 3 ? 2 : phase) as (typeof STAGES)[number])) + 1;

// The job status the team works with (replaces JobTread's Status field). The
// database sets the client-facing phase from it.
export const LEAD_STATUSES = ["New Lead", "Estimating", "On Hold", "Closed Lost"] as const;
export const JOB_STATUSES = ["Approved", "Preconstruction", "Permitting", "Construction", "Complete"] as const;
export const ALL_STATUSES = [...LEAD_STATUSES, ...JOB_STATUSES] as const;
export type JobStatus = (typeof ALL_STATUSES)[number];
export const isLead = (s: string | null | undefined) => (LEAD_STATUSES as readonly string[]).includes(s ?? "");
// The statuses a PM works in, and may switch between.
export const PM_STATUSES = ["Permitting", "Construction"] as const;
export const JOB_TYPES = ["New Build Out", "Interior Fit-Out", "Cosmetic Renovation", "Minor Renovation", "Weekend Project", "Preconstruction Package"] as const;

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
