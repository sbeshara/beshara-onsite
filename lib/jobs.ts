import { LEAD_STATUSES } from "./constants";

// For Supabase filters: .not("status", "in", LEAD_FILTER) leaves leads out.
export const LEAD_FILTER = `(${LEAD_STATUSES.map((s) => `"${s}"`).join(",")})`;
