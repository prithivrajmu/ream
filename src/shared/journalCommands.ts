export type JournalCommandName = "recap" | "today" | "template";

export interface JournalCommandDateRange {
  startDateKey: string;
  endDateKey: string;
  label: string;
}

export type ParsedJournalCommand =
  | { kind: "not-command" }
  | { kind: "help"; markdown: string }
  | { kind: "recap"; range: JournalCommandDateRange; normalizedCommand: string }
  | { kind: "error"; message: string; helpMarkdown: string };

export interface JournalCommandDefinition {
  name: JournalCommandName;
  implemented: boolean;
  description: string;
}

export const JOURNAL_COMMAND_REGISTRY: readonly JournalCommandDefinition[] = [
  { name: "recap", implemented: true, description: "Summarize entries and handwritten notes for a date range." },
  { name: "today", implemented: false, description: "Reserved for opening today's journal page." },
  { name: "template", implemented: false, description: "Reserved for inserting journal templates." }
];

export const RECAP_HELP_MARKDOWN = `### Recap commands

- \`/recap @yesterday\` — recap the previous local calendar day
- \`/recap @MM-DD-YYYY\` — recap a specific local calendar day
- \`/recap @previousweek\` — recap the previous Monday through Sunday
- \`/recap @help\` — show this help`;

export function parseJournalCommand(input: string, now = new Date()): ParsedJournalCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "not-command" };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts[0]?.slice(1).toLocaleLowerCase();
  if (command !== "recap") {
    return commandError(`Unknown command \`/${command || ""}\`.`);
  }
  if (parts.length !== 2) {
    return commandError("Use exactly one date selector with `/recap`.");
  }

  const selector = parts[1]?.toLocaleLowerCase();
  if (selector === "@help") {
    return { kind: "help", markdown: RECAP_HELP_MARKDOWN };
  }
  if (selector === "@yesterday") {
    const date = addLocalDays(startOfLocalDay(now), -1);
    const dateKey = toLocalDateKey(date);
    return { kind: "recap", range: { startDateKey: dateKey, endDateKey: dateKey, label: formatRangeLabel(dateKey, dateKey) }, normalizedCommand: "/recap @yesterday" };
  }
  if (selector === "@previousweek") {
    const today = startOfLocalDay(now);
    const daysSinceMonday = (today.getDay() + 6) % 7;
    const currentMonday = addLocalDays(today, -daysSinceMonday);
    const previousMonday = addLocalDays(currentMonday, -7);
    const previousSunday = addLocalDays(currentMonday, -1);
    const startDateKey = toLocalDateKey(previousMonday);
    const endDateKey = toLocalDateKey(previousSunday);
    return { kind: "recap", range: { startDateKey, endDateKey, label: formatRangeLabel(startDateKey, endDateKey) }, normalizedCommand: "/recap @previousweek" };
  }

  const explicitDate = /^@(\d{2})-(\d{2})-(\d{4})$/.exec(selector ?? "");
  if (!explicitDate) {
    return commandError("Use `@yesterday`, `@previousweek`, `@help`, or a date in `MM-DD-YYYY` format.");
  }
  const month = Number(explicitDate[1]);
  const day = Number(explicitDate[2]);
  const year = Number(explicitDate[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return commandError("Enter a real calendar date in `MM-DD-YYYY` format.");
  }
  const dateKey = toLocalDateKey(date);
  return {
    kind: "recap",
    range: { startDateKey: dateKey, endDateKey: dateKey, label: formatRangeLabel(dateKey, dateKey) },
    normalizedCommand: `/recap @${explicitDate[1]}-${explicitDate[2]}-${explicitDate[3]}`
  };
}

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromLocalDateKey(dateKey: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    throw new Error("Invalid local date key.");
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (toLocalDateKey(date) !== dateKey) {
    throw new Error("Invalid local date key.");
  }
  return date;
}

export function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatRangeLabel(startDateKey: string, endDateKey: string): string {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const start = formatter.format(fromLocalDateKey(startDateKey));
  if (startDateKey === endDateKey) {
    return start;
  }
  return `${start} – ${formatter.format(fromLocalDateKey(endDateKey))}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function commandError(message: string): ParsedJournalCommand {
  return { kind: "error", message, helpMarkdown: RECAP_HELP_MARKDOWN };
}
