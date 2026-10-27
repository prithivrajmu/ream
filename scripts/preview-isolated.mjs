// Launch the real desktop app with disposable data, without opening a user's workspace.
import { app } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previewDirectory = mkdtempSync(join(tmpdir(), "ream-preview-"));
app.setPath("appData", previewDirectory);
app.setPath("userData", previewDirectory);
app.setPath("sessionData", previewDirectory);
console.log(`Isolated Ream preview data: ${previewDirectory}`);
await import(new URL("../out/main/index.js", import.meta.url).href);
