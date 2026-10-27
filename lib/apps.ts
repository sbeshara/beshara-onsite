import type { Role } from "./types";

// The tiles on Beshara HQ. To add an app, add an entry here.
export type TeamApp = {
  key: string;
  name: string;
  blurb: string;
  url: string;
  icon: "chat" | "report" | "hammer" | "people" | "sheet" | "folder";
  external?: boolean; // made by someone else (opens in a new tab)
  roles?: Role[]; // who sees it; everyone on the team when left out
};

export const HQ_URL = process.env.NEXT_PUBLIC_HQ_URL ?? "https://hq.besharabuilders.com";
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://onsite.besharabuilders.com";
const REPORTS = process.env.NEXT_PUBLIC_REPORTS_URL ?? "https://reports.besharabuilders.com";

export const TEAM_APPS: TeamApp[] = [
  { key: "onsite", name: "OnSite", blurb: "Client chats, files and photos for every project.", url: SITE, icon: "chat" },
  { key: "reports", name: "Reports", blurb: "Review and approve the weekly progress reports.", url: REPORTS, icon: "report" },
  { key: "jobtread", name: "JobTread", blurb: "Estimates, budgets, schedules and daily logs.", url: "https://app.jobtread.com", icon: "hammer", external: true },
  {
    key: "pco-log",
    name: "PCO log",
    blurb: "Potential change orders across every job.",
    url: "https://docs.google.com/spreadsheets/d/1ORDX7I0ZjxZqcfRVV7lfv9Tlrdy6uCZ0u-lUFyloACA/edit",
    icon: "sheet",
    external: true,
  },
  {
    key: "look-ahead",
    name: "2-week look ahead",
    blurb: "What's scheduled on every job for the next two weeks.",
    url: "https://docs.google.com/spreadsheets/d/1rcaoGaxqHSQDNtmTJGqsW7JGAaH7J2Kr/edit",
    icon: "sheet",
    external: true,
  },
  { key: "team", name: "Team & access", blurb: "Invite teammates and set who sees what.", url: `${SITE}/team`, icon: "people", roles: ["owner", "admin"] },
];
