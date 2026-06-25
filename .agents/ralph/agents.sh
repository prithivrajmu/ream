#!/usr/bin/env bash

AGENT_CODEX_CMD="codex exec --yolo --skip-git-repo-check -"
AGENT_CLAUDE_CMD="claude -p --dangerously-skip-permissions \"\$(cat {prompt})\""
AGENT_DROID_CMD="droid exec --skip-permissions-unsafe -f {prompt}"
DEFAULT_AGENT="codex"
