export const PHASES = ["Preconstruction", "Permits", "Construction", "Punch list", "Closeout"] as const;

export const FOLDERS = ["Drawings", "Submittals", "Permits & inspections", "Photos", "Contracts"] as const;
export type Folder = (typeof FOLDERS)[number];

export const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  construction: "Construction Management",
  client: "Client",
} as const;

export const FILES_BUCKET = "project-files";
