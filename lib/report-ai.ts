import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { DailyLog } from "./jobtread";

export const ReportSchema = z.object({
  completed: z.array(z.object({ trade: z.string(), text: z.string() })),
  looking_ahead: z.array(z.object({ trade: z.string(), text: z.string() })),
  friday_section_found: z.boolean(),
});
export type ReportDraft = z.infer<typeof ReportSchema>;

const SYSTEM = `You write the weekly client progress report for Beshara Builders, a healthcare construction management firm in New Jersey that builds out dental and medical offices. The reader is the client: a doctor or practice owner.

You get the daily logs the site team wrote from Monday through Saturday of one week.

completed: 1 to 4 high-level "Trade: summary" bullets for the whole week.
- trade is the trade or area (Drywall, Painting, Flooring, Electrical, Carpentry, Millwork, Plumbing, HVAC, Materials, Site, and so on).
- text summarizes that trade's work for the week in one line, past tense. Combine related work with semicolons.
- No dates. Leave out minor items and one-off events.
- Examples:
  { "trade": "Drywall", "text": "Finished entryways with three coats and corner beads; taped and spackled remaining areas in the 2nd floor client space" }
  { "trade": "Painting", "text": "Completed painting of all doors and trim" }
  { "trade": "Materials", "text": "Bathroom floor and base tile received on site" }

looking_ahead: taken ONLY from the Friday daily log's work-to-be-conducted section (it may be headed "Work to be conducted", "Look ahead", "Next week", or similar). Do not use any other day's log, and do not guess.
- Same "Trade: summary" style, short, future work. Example: { "trade": "Painting", "text": "Mobilize for primer and base coat; prep all areas" }
- If there is no Friday log, or the Friday log has no work-to-be-conducted section, return an empty list and set friday_section_found to false. Otherwise set it to true.

Always:
- Write for the client: professional, plain and specific.
- Leave out anything internal: crew sizes and crew or subcontractor names, prices, costs, purchases, change order amounts, delays blamed on anyone, disagreements and internal problems.
- Only include what the logs support. Never invent work.`;

function describe(logs: DailyLog[], fridayDate: string, project: string, weekOf: string) {
  const text = logs
    .map((l) => {
      const day = new Date(`${l.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      return `## ${day} ${l.date}${l.date === fridayDate ? " (FRIDAY LOG)" : ""}${l.trades.length ? ` (trades onsite: ${l.trades.join(", ")})` : ""}\n${l.notes.trim() || "(no notes)"}`;
    })
    .join("\n\n");
  const friday = logs.some((l) => l.date === fridayDate) ? "" : "\n\nThere is no Friday log this week.";
  return `Project: ${project}\nWeek of ${weekOf} (Monday through Saturday).\n\n# Daily logs\n\n${text}${friday}`;
}

export async function draftReport(args: { project: string; weekOf: string; fridayDate: string; logs: DailyLog[] }): Promise<ReportDraft> {
  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: process.env.REPORT_MODEL ?? "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(ReportSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: describe(args.logs, args.fridayDate, args.project, args.weekOf) }],
  });
  if (response.stop_reason === "refusal") throw new Error("The AI declined to write this report. Write it by hand in the editor.");
  const out = response.parsed_output;
  if (!out) throw new Error("The AI response couldn't be read. Try drafting again.");
  const hasFriday = args.logs.some((l) => l.date === args.fridayDate);
  return {
    completed: out.completed.slice(0, 4),
    looking_ahead: hasFriday && out.friday_section_found ? out.looking_ahead : [],
    friday_section_found: hasFriday && out.friday_section_found,
  };
}
