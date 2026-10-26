export type Role = "owner" | "admin" | "construction" | "client";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  title: string | null;
};

export type Project = {
  id: string;
  name: string;
  town: string;
  scope: string | null;
  phase: number;
  primary_client_id: string | null;
  created_at: string;
};

export type Chat = {
  id: string;
  project_id: string;
  name: string;
  is_internal: boolean;
  position: number;
  created_by: string | null;
};

export type FileRow = {
  id: string;
  project_id: string;
  message_id: string | null;
  name: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  folder: string;
  is_internal: boolean;
  uploaded_by: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  chat_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  files?: FileRow[];
};

export const isAdminRole = (r: Role) => r === "owner" || r === "admin";
export const isTeamRole = (r: Role) => r !== "client";
