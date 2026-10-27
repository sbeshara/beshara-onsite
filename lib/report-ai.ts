import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DailyLog, ScheduleItem } from "./jobtread";

export const ReportSchema = z.object({
  completed: z.array(z.object({ trade: z.string(), text: z.string() })),
  looking_ahead: z.array(z.object({ trade: z.string(), text: z.string(), date: z.string() })),
});
export type ReportDraft = z.infer<typeof ReportSchema>;

const SYSTEM = `You write the weekly client progress report for Beshara Builders, a healthcare construction management firm in New Jersey that builds out dental and medical offices.

You'll get the past week's daily logs written by the site team, plus schedule items for the coming two weeks. Write the report the client (a doctor or practice owner) receives.

Format, matching the firm's existing reports:
- completed: one entry per trade (Carpentry, Electrical, Plumbing, Flooring, Paint, Millwork, Demo, Equipment, HVAC, Framing, Drywall, Tile, Inspections, and so on). The text is one or two short, plain sentences in past tense describing what was done, with specifics like room names and numbers. Example: { trade: "Millwork", text: "Installed cabinetry and shelving in Rooms 1, 2, and 3. Shelf to be added in Room 2." }
- looking_ahead: one entry per trade for the coming week, in future/imperative tense, with the expected date as M/D (e.g. "10/28") when the logs or schedule give one, otherwise an empty string. Example: { trade: "Paint", text: "Paint all doors and trim.", date: "10/30" }

Rules:
- Write for the client: professional, calm and specific. No construction slang.
- Leave out anything internal: crew sizes and names, subcontractor names, prices, costs, change order amounts, delays blamed on anyone, disagreements, problems still being worked out internally, and notes like "no staff on site".
- Only include work the logs actually support. Never invent work, dates or rooms.
- Combine repeated work across days into one entry per trade. Order trades roughly by when the work happened.
- If the logs only describe coordination (deliveries, walkthroughs, scheduling), it's fine to list that under the relevant trade or "Coordination".
- If there's nothing for a section, return an empty list.`;

function describe(logs: DailyLog[], schedule: ScheduleItem[], project: string, weekOf: string) {
  const logText = logs
    .map((l) => `## ${l.date}${l.trades.length ? ` (trades onsite: ${l.trades.join(", ")})` : ""}\n${l.notes.trim() || "(no notes)"}`)
    .join("\n\n");
  const sched = schedule.length
    ? schedule.map((s) => `- ${s.name}: ${s.start ?? "?"} to ${s.end ?? "?"}`).join("\n")
    : "(none in the schedule)";
  return `Project: ${project}\nReport for the week of ${weekOf}.\n\n# Daily logs\n\n${logText}\n\n# Schedule, next two weeks\n\n${sched}`;
}

export async function draftReport(args: { project: string; weekOf: string; logs: DailyLog[]; schedule: ScheduleItem[] }): Promise<ReportDraft> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: process.env.REPORT_MODEL ?? "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: describe(args.logs, args.schedule, args.project, args.weekOf) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to write this report. Write it by hand in the editor.");
  if (!response.parsed_output) throw new Error("The AI response couldn't be read. Try generating again.");
  return response.parsed_output;
}
