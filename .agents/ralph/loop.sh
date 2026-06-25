#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.sh"

AGENT_CMD="codex exec --yolo --skip-git-repo-check -"
PRD_PATH=".agents/tasks/prd.json"
PROMPT_BUILD=".agents/ralph/PROMPT_build.md"
PROGRESS_PATH=".ralph/progress.md"
TMP_DIR=".ralph/.tmp"
RUNS_DIR=".ralph/runs"
NO_COMMIT=false
MAX_ITERATIONS=2

if [[ -f "${CONFIG_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${CONFIG_FILE}"
fi

abs_path() {
  local value="$1"
  if [[ "${value}" = /* ]]; then
    printf '%s' "${value}"
  else
    printf '%s/%s' "${ROOT_DIR}" "${value}"
  fi
}

run_agent() {
  local prompt_file="$1"
  if [[ "${AGENT_CMD}" == *"{prompt}"* ]]; then
    local escaped
    escaped=$(printf '%q' "${prompt_file}")
    local cmd="${AGENT_CMD//\{prompt\}/${escaped}}"
    eval "${cmd}"
  else
    cat "${prompt_file}" | eval "${AGENT_CMD}"
  fi
}

PRD_PATH="$(abs_path "${PRD_PATH}")"
PROMPT_BUILD="$(abs_path "${PROMPT_BUILD}")"
PROGRESS_PATH="$(abs_path "${PROGRESS_PATH}")"
TMP_DIR="$(abs_path "${TMP_DIR}")"
RUNS_DIR="$(abs_path "${RUNS_DIR}")"

while [[ $# -gt 0 ]]; do
  case "$1" in
    build)
      shift
      ;;
    --no-commit)
      NO_COMMIT=true
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
        shift
      else
        echo "Unknown arg: $1"
        exit 1
      fi
      ;;
  esac
done

mkdir -p "$(dirname "${PROGRESS_PATH}")" "${TMP_DIR}" "${RUNS_DIR}"

for ((iteration=1; iteration<=MAX_ITERATIONS; iteration+=1)); do
  story_json="$(python3 - <<'PY' "${PRD_PATH}"
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
for story in data.get("stories", []):
    if story.get("status") == "todo":
        print(json.dumps(story))
        break
PY
)"

  if [[ -z "${story_json}" ]]; then
    echo "No todo stories found in ${PRD_PATH}"
    exit 0
  fi

  story_id="$(python3 - <<'PY' "${story_json}"
import json, sys
print(json.loads(sys.argv[1])["id"])
PY
)"
  story_title="$(python3 - <<'PY' "${story_json}"
import json, sys
print(json.loads(sys.argv[1])["title"])
PY
)"
  run_id="$(date +%Y%m%d-%H%M%S)-${story_id}-${iteration}"
  prompt_path="${TMP_DIR}/prompt-${run_id}.md"
  run_log_path="${RUNS_DIR}/${run_id}.log"

  python3 - <<'PY' "${PROMPT_BUILD}" "${prompt_path}" "${PRD_PATH}" "${story_json}" "${NO_COMMIT}" "${iteration}" "${run_id}" "${run_log_path}" "${PROGRESS_PATH}"
import json, sys
from pathlib import Path

template = Path(sys.argv[1]).read_text(encoding="utf-8")
story = json.loads(sys.argv[4])
rendered = (
    template
    .replace("{{PRD_PATH}}", sys.argv[3])
    .replace("{{STORY_ID}}", story["id"])
    .replace("{{STORY_TITLE}}", story["title"])
    .replace("{{STORY_BLOCK}}", json.dumps(story, indent=2))
    .replace("{{NO_COMMIT}}", sys.argv[5].lower())
    .replace("{{ITERATION}}", sys.argv[6])
    .replace("{{RUN_ID}}", sys.argv[7])
    .replace("{{RUN_LOG_PATH}}", sys.argv[8])
    .replace("{{PROGRESS_PATH}}", sys.argv[9])
)
Path(sys.argv[2]).write_text(rendered, encoding="utf-8")
PY

  if ! run_agent "${prompt_path}" | tee "${run_log_path}"; then
    python3 - <<'PY' "${PROGRESS_PATH}" "${story_id}" "${story_title}" "${run_id}"
from datetime import datetime
from pathlib import Path
import sys

progress_path = Path(sys.argv[1])
progress_path.parent.mkdir(parents=True, exist_ok=True)
with progress_path.open("a", encoding="utf-8") as handle:
    handle.write(
        f"## [{datetime.utcnow().isoformat()}Z] - {sys.argv[2]}: {sys.argv[3]}\n"
        f"- Run: {sys.argv[4]}\n"
        "- Result: agent run failed before completion\n"
        "---\n"
    )
PY
    echo "Agent run failed for ${story_id}"
    exit 1
  fi

  if ! grep -q "<promise>COMPLETE</promise>" "${run_log_path}"; then
    python3 - <<'PY' "${PROGRESS_PATH}" "${story_id}" "${story_title}" "${run_id}"
from datetime import datetime
from pathlib import Path
import sys

progress_path = Path(sys.argv[1])
progress_path.parent.mkdir(parents=True, exist_ok=True)
with progress_path.open("a", encoding="utf-8") as handle:
    handle.write(
        f"## [{datetime.utcnow().isoformat()}Z] - {sys.argv[2]}: {sys.argv[3]}\n"
        f"- Run: {sys.argv[4]}\n"
        "- Result: completion signal missing\n"
        "---\n"
    )
PY
    echo "Agent did not return completion signal for ${story_id}"
    exit 1
  fi

  python3 - <<'PY' "${PRD_PATH}" "${story_id}" "${NO_COMMIT}" "${run_id}" "${story_title}" "${PROGRESS_PATH}"
import json, sys
from datetime import datetime
from pathlib import Path

prd_path = Path(sys.argv[1])
story_id = sys.argv[2]
no_commit = sys.argv[3]
run_id = sys.argv[4]
story_title = sys.argv[5]
progress_path = Path(sys.argv[6])

data = json.loads(prd_path.read_text(encoding="utf-8"))
for story in data.get("stories", []):
    if story.get("id") == story_id:
        story["status"] = "done"
        story["completedAt"] = datetime.utcnow().isoformat() + "Z"
        break
prd_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

progress_path.parent.mkdir(parents=True, exist_ok=True)
with progress_path.open("a", encoding="utf-8") as handle:
    handle.write(
        f"## [{datetime.utcnow().isoformat()}Z] - {story_id}: {story_title}\n"
        f"- Run: {run_id}\n"
        f"- No-commit: {no_commit}\n"
        f"- Result: completed by bounded Ralph loop\n"
        "---\n"
    )
PY
done
