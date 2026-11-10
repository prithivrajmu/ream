import type { GenerateRecapRequest, ImprovedNoteOutput } from "../../shared/ai";

// Synthetic, fixture-specific regression probes, not a general language validator.
// Keep expectations fixed when comparing prompts. Novel paraphrases need human review.
export const AI_MEANING_CORPUS_VERSION = "meaning-v1";
export interface NarrativeRule {
  meaning: string;
  supported: RegExp;
  inverted: RegExp;
}
export interface MeaningCase {
  id: string;
  source: string;
  taskTitle: string;
  recapOnly?: boolean;
  journal?: boolean;
  narrative: NarrativeRule[];
  actions: RegExp[];
  blockers: RegExp[];
  faithful: [string, string];
  faithfulActions: string[];
  faithfulBlockers: string[];
  badNarratives: string[];
  badAction: string;
}

const checkedExport: NarrativeRule = {
  meaning: "backup export was checked, not awaiting a check",
  supported: /\b(?:checked|verified|reviewed) (?:the )?backup export\b|\bbackup export (?:was |has been |is )?(?:checked|verified|reviewed)\b/i,
  inverted: /\b(?:next[: ]+|will |to |need(?:s)? to |plan(?:s|ned)? to )(?:check|verify|review) (?:the )?backup export\b|\bbackup export (?:still )?(?:needs|awaits|requires) (?:a )?(?:check|review|verification)\b|\b(?:not|never|haven't|hasn't) (?:yet )?(?:checked|verified|reviewed) (?:the )?backup export\b/i
};
const plannedDraft: NarrativeRule = {
  meaning: "draft review remains planned for tomorrow, not completed",
  supported: /\b(?:review|look over) (?:the )?draft tomorrow\b|\bdraft (?:review|will be reviewed|is to be reviewed|is scheduled for review) (?:is )?(?:planned |scheduled )?(?:for )?tomorrow\b/i,
  inverted: /(?<!not )(?<!never )(?<!haven't )\b(?:reviewed|finished reviewing|completed (?:the )?review of) (?:the )?draft\b|\bdraft (?:was |has been |is )?(?:already )?reviewed\b|\bdraft review (?:was |is |has been )?(?:complete|completed|finished|done)\b/i
};
const draftAction = /^(?:review|look over) (?:the )?draft(?: tomorrow| the next day)?[.!]?$/i;
const currentCredentials: NarrativeRule = {
  meaning: "upload is still blocked by missing credentials",
  supported: /\bupload (?:is |remains |was )?(?:still )?(?:blocked|paused|on hold)[^.!?;\n]*\b(?:(?:missing|unavailable|pending|awaiting|waiting for) (?:the )?credentials|credentials (?:are |remain )?(?:missing|unavailable))\b|\b(?:missing|unavailable) credentials[^.!?;\n]*\b(?:block|prevent|hold up)(?:s|ed|ing)? (?:the )?upload\b/i,
  inverted: /\b(?:completed|finished|resumed) (?:the )?upload\b|\bupload (?:was |is |has been )?(?:complete|completed|finished|resumed)\b|\bcredentials (?:were |are |have been )?(?:restored|received|available)\b/i
};

export const AI_MEANING_CASES: MeaningCase[] = [
  {
    id: "completed-only", source: "Checked the backup export. The check is finished.", taskTitle: "Check backup export",
    narrative: [checkedExport], actions: [], blockers: [],
    faithful: ["Checked the backup export.", "The backup export has been verified."], faithfulActions: [], faithfulBlockers: [],
    badNarratives: ["Next: check the backup export.", "The backup export still needs a check."], badAction: "Check the backup export."
  },
  {
    id: "planned-only", source: "Plan: review the draft tomorrow. The review has not started.", taskTitle: "Review draft",
    narrative: [plannedDraft], actions: [draftAction], blockers: [],
    faithful: ["Plan to review the draft tomorrow.", "The draft review is scheduled for tomorrow; it has not started."],
    faithfulActions: ["Review the draft tomorrow."], faithfulBlockers: [],
    badNarratives: ["Reviewed the draft.", "The draft review is complete."], badAction: "Completed the draft review."
  },
  {
    id: "export-draft-regression", source: "checked backup export. next: review the draft tomorrow.", taskTitle: "Backup QA", journal: true,
    narrative: [checkedExport, plannedDraft], actions: [draftAction], blockers: [],
    faithful: ["Checked the backup export. Next: review the draft tomorrow.", "The backup export was verified; the draft review is planned for tomorrow."],
    faithfulActions: ["Review the draft tomorrow."], faithfulBlockers: [],
    badNarratives: ["Next: check the backup export and review the draft tomorrow.", "Checked the backup export and reviewed the draft."], badAction: "Check the backup export."
  },
  {
    id: "explicit-follow-up", source: "Signed the bundle. Next: email the download link tomorrow.", taskTitle: "Release preparation", journal: true,
    narrative: [
      { meaning: "bundle signing is completed", supported: /\b(?:signed (?:the )?bundle|bundle (?:was |is |has been )?signed)\b/i, inverted: /\b(?:will|to|next:) sign (?:the )?bundle\b|\bbundle (?:needs|awaits|requires) signing\b/i },
      { meaning: "emailing the link is still a follow-up", supported: /\b(?:email|send) (?:the )?download link tomorrow\b|\bdownload link (?:will be|is to be) (?:emailed|sent) tomorrow\b/i, inverted: /\b(?:emailed|sent) (?:the )?download link\b|\bdownload link (?:was|has been) (?:emailed|sent)\b/i }
    ], actions: [/^(?:email|send) (?:the )?download link(?: tomorrow| the next day)?[.!]?$/i], blockers: [],
    faithful: ["Signed the bundle. Next: email the download link tomorrow.", "The bundle has been signed; the download link will be sent tomorrow."],
    faithfulActions: ["Email the download link tomorrow."], faithfulBlockers: [],
    badNarratives: ["Plan to sign the bundle and email the download link tomorrow.", "Signed the bundle and emailed the download link."], badAction: "Sign the bundle."
  },
  {
    id: "current-blocker", source: "Upload is paused because credentials are missing. No follow-up action has been decided.", taskTitle: "Upload artifact",
    narrative: [currentCredentials], actions: [], blockers: [/^(?:(?:missing|unavailable|awaiting|waiting for) credentials|credentials (?:are )?(?:missing|unavailable))[.!]?$/i],
    faithful: ["The upload is blocked by missing credentials.", "Missing credentials prevent the upload; no next action has been decided."],
    faithfulActions: [], faithfulBlockers: ["Missing credentials."],
    badNarratives: ["Completed the upload after credentials were restored.", "Credentials are available and the upload has been resumed."], badAction: "Request credentials."
  },
  {
    id: "resolved-blocker", source: "Credentials were restored. Finished the upload. Nothing is blocked now.", taskTitle: "Upload artifact", journal: true,
    narrative: [
      { meaning: "credentials issue is resolved", supported: /\bcredentials (?:were |are |have been )?(?:restored|available|recovered)\b|\b(?:restored|recovered) (?:the )?credentials\b/i, inverted: /\b(?:missing|unavailable|awaiting) credentials\b|\bcredentials (?:are |remain )?(?:missing|unavailable)\b/i },
      { meaning: "upload is finished, not blocked or planned", supported: /\b(?:finished|completed) (?:the )?upload\b|\bupload (?:is |was |has been )?(?:complete|completed|finished)\b/i, inverted: /\bupload (?:is |remains )?(?:blocked|paused|pending)\b|\b(?:next:|to|will) (?:finish|complete|resume) (?:the )?upload\b/i }
    ], actions: [], blockers: [],
    faithful: ["Credentials were restored. Finished the upload.", "Credentials are available and the upload is complete."], faithfulActions: [], faithfulBlockers: [],
    badNarratives: ["The upload is blocked by missing credentials.", "Credentials were restored; next: finish the upload."], badAction: "Resume the upload."
  },
  {
    id: "negated-cancelled", source: "Did not publish the release. Publication is cancelled; do not publish it today.", taskTitle: "Publish release",
    narrative: [
      { meaning: "release was not published", supported: /\b(?:did not|didn't|never) publish (?:the )?release\b|\brelease (?:was not |wasn't |has not been |remains un)published\b/i, inverted: /(?<!not )(?<!never )\bpublished (?:the )?release\b|\brelease (?:was|has been) published\b/i },
      { meaning: "publication is cancelled, not a future task", supported: /\bpublication (?:is |was |has been )?cancelled\b|\bcancelled (?:the )?publication\b/i, inverted: /\b(?:will|to|next:) publish (?:the )?release\b/i }
    ],
    actions: [], blockers: [], faithful: ["Did not publish the release; publication is cancelled.", "The release was not published. Publication has been cancelled."],
    faithfulActions: [], faithfulBlockers: [], badNarratives: ["Published the release.", "Next: publish the release."], badAction: "Publish the release today."
  },
  {
    id: "tentative-undecided", source: "Maybe investigate the cache later? No decision yet.", taskTitle: "Cache investigation", journal: true,
    narrative: [{ meaning: "cache investigation is tentative, not committed or completed", supported: /\b(?:maybe|might|could|possibly) investigate (?:the )?cache\b|\bcache investigation (?:is |remains )?(?:tentative|undecided|unconfirmed)\b|\b(?:considering|considered) (?:a )?cache investigation\b/i, inverted: /\b(?:will|to|next:) investigate (?:the )?cache\b|\binvestigated (?:the )?cache\b|\bcache investigation (?:is |was )?(?:complete|completed|scheduled|planned)\b/i }],
    actions: [], blockers: [], faithful: ["Maybe investigate the cache later; no decision yet.", "Cache investigation remains tentative."],
    faithfulActions: [], faithfulBlockers: [], badNarratives: ["Investigated the cache.", "Will investigate the cache later."], badAction: "Investigate the cache."
  },
  {
    id: "recorded-time-not-completion", source: "Upload is blocked by missing credentials. Upload has not started. No next action is decided.", taskTitle: "Upload artifact", recapOnly: true,
    narrative: [currentCredentials], actions: [], blockers: [],
    faithful: ["Recorded time on the artifact task; the upload remains blocked by missing credentials.", "Missing credentials prevent the upload despite time recorded on the task."],
    faithfulActions: [], faithfulBlockers: [], badNarratives: ["Completed the upload in ten minutes.", "The upload is complete; credentials are available."], badAction: "Upload the artifact."
  }
];

export function faithfulNote(fixture: MeaningCase, variant = 0): ImprovedNoteOutput {
  return { clean_note: fixture.faithful[variant], summary: fixture.faithful[variant], next_steps: fixture.faithfulActions, blockers: fixture.faithfulBlockers, tags: ["synthetic"] };
}

export function recapRequest(fixture: MeaningCase, model: string): GenerateRecapRequest {
  return {
    model, sourceLabel: `Synthetic ${fixture.id}`, sourceStartDateKey: "2026-09-15", sourceEndDateKey: "2026-09-15",
    entries: fixture.journal ? [] : [{ startedAt: "2026-09-15T09:00:00Z", endedAt: "2026-09-15T09:10:00Z", durationSeconds: 600, taskTitle: fixture.taskTitle, projectNames: ["Synthetic quality probe"], note: fixture.source }],
    journalPages: fixture.journal ? [{ dateKey: "2026-09-15", markdown: fixture.source }] : []
  };
}
