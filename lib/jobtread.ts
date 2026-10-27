import "server-only";

// JobTread's API ("Pave"): one endpoint, JSON queries, the grant key in the root "$".
const ENDPOINT = process.env.JOBTREAD_API_URL ?? "https://api.jobtread.com/pave";

export class JobTreadError extends Error {}

export async function pave<T = Record<string, unknown>>(query: Record<string, unknown>): Promise<T> {
  const grantKey = process.env.JOBTREAD_GRANT_KEY;
  if (!grantKey) throw new JobTreadError("JOBTREAD_GRANT_KEY is not set");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new JobTreadError(`JobTread ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new JobTreadError(`JobTread returned something unexpected: ${text.slice(0, 300)}`);
  }
}

let orgId: string | null = process.env.JOBTREAD_ORG_ID ?? null;
// A grant made for a person (not the company) has no organization of its
// own, so fall back to the company that person belongs to.
async function organizationId() {
  if (orgId) return orgId;
  const r = await pave<{
    currentGrant: {
      organization: { id: string } | null;
      user: { memberships: { nodes: { organization: { id: string } | null }[] } } | null;
    } | null;
  }>({ currentGrant: { organization: { id: {} }, user: { memberships: { nodes: { organization: { id: {} } } } } } });
  const g = r.currentGrant;
  if (!g) throw new JobTreadError("JobTread didn't accept the grant key. Check JOBTREAD_GRANT_KEY in Vercel.");
  const id = g.organization?.id ?? g.user?.memberships.nodes.find((m) => m.organization)?.organization?.id;
  if (!id) throw new JobTreadError("This grant key isn't connected to a JobTread company.");
  orgId = id;
  return orgId;
}

export type JobOption = { id: string; label: string; number: string; client: string | null; town: string | null };

// Open jobs whose "Status" custom field is Construction, newest first,
// labelled the way the office knows them.
export async function listOpenJobs(): Promise<JobOption[]> {
  const org = await organizationId();
  const r = await pave<{
    organization: { jobs: { nodes: { id: string; name: string; number: string; location: { name: string; address: string | null; account: { name: string } | null } | null }[] } };
  }>({
    organization: {
      $: { id: org },
      jobs: {
        $: {
          with: {
            status: {
              _: "customFieldValues",
              $: { where: { and: [[["customField", "name"], "Status"], ["value", "Construction"]] } },
              count: {},
            },
          },
          where: { and: [["closedOn", null], [["status", "count"], ">", 0]] },
          size: 100,
          sortBy: [{ field: "createdAt", order: "desc" }],
        },
        nodes: { id: {}, name: {}, number: {}, location: { name: {}, address: {}, account: { name: {} } } },
      },
    },
  });
  return r.organization.jobs.nodes.map((j) => {
    const who = j.location?.account?.name;
    const town = j.location?.address?.split(",").slice(-3, -2)[0]?.trim();
    const name = j.name && !/^Job \d+$/.test(j.name) ? j.name : null;
    return { id: j.id, label: [j.number, who, name, town].filter(Boolean).join(" · "), number: j.number, client: who ?? name, town: town ?? null };
  });
}

export type DailyLog = {
  id: string;
  date: string;
  author: string;
  notes: string;
  trades: string[];
  photos: { id: string; name: string }[];
};

export type ScheduleItem = { name: string; start: string | null; end: string | null };

const isPhoto = (type: string, name: string) => /^image\//.test(type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(name);

// Daily logs for one job between two dates (inclusive), oldest first.
export async function dailyLogs(jobId: string, from: string, to: string): Promise<DailyLog[]> {
  const r = await pave<{
    job: {
      dailyLogs: {
        nodes: {
          id: string;
          date: string;
          notes: string | null;
          user: { name: string } | null;
          customFieldValues: { nodes: { value: unknown; customField: { name: string } }[] };
          files: { nodes: { id: string; name: string; type: string }[] } | null;
        }[];
      };
    };
  }>({
    job: {
      $: { id: jobId },
      dailyLogs: {
        // JobTread refuses queries whose page sizes multiply out too large
          // (100 logs x 50 files is rejected even for an empty week).
          $: { where: { and: [["date", ">=", from], ["date", "<=", to]] }, size: 20, sortBy: [{ field: "date", order: "asc" }] },
        nodes: {
          id: {},
          date: {},
          notes: {},
          user: { name: {} },
          customFieldValues: { $: { size: 10 }, nodes: { value: {}, customField: { name: {} } } },
          files: { $: { size: 25 }, nodes: { id: {}, name: {}, type: {} } },
        },
      },
    },
  });
  return r.job.dailyLogs.nodes.map((l) => ({
    id: l.id,
    date: l.date,
    author: l.user?.name ?? "",
    notes: l.notes ?? "",
    trades: l.customFieldValues.nodes
      .filter((v) => /trade/i.test(v.customField.name))
      .flatMap((v) => (Array.isArray(v.value) ? v.value.map(String) : String(v.value ?? "").split(/,\s*/)))
      .filter(Boolean),
    photos: (l.files?.nodes ?? []).filter((f) => isPhoto(f.type, f.name)).map((f) => ({ id: f.id, name: f.name })),
  }));
}

// Schedule items that start or are underway in the given window.
export async function scheduleBetween(jobId: string, from: string, to: string): Promise<ScheduleItem[]> {
  const r = await pave<{ job: { tasks: { nodes: { name: string; startDate: string | null; endDate: string | null; isToDo: boolean; isGroup: boolean }[] } } }>({
    job: {
      $: { id: jobId },
      tasks: {
        $: { where: { and: [["isToDo", false], ["startDate", "<=", to], ["endDate", ">=", from]] }, size: 50, sortBy: [{ field: "startDate", order: "asc" }] },
        nodes: { name: {}, startDate: {}, endDate: {}, isToDo: {}, isGroup: {} },
      },
    },
  });
  return r.job.tasks.nodes.filter((t) => !t.isGroup).map((t) => ({ name: t.name, start: t.startDate, end: t.endDate }));
}

// Fresh, short-lived links for JobTread photos (optionally resized).
export async function fileUrls(ids: string[], size?: number): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const query: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    query[`f${i}`] = { _: "file", $: { id }, id: {}, url: size ? { $: { size } } : {} };
  });
  const r = await pave<Record<string, { id: string; url: string | null }>>(query);
  const out: Record<string, string> = {};
  for (const v of Object.values(r)) if (v?.url) out[v.id] = v.url;
  return out;
}
