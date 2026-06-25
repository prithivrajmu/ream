export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`;
  }

  return `${minutes}:${pad(remainingSeconds)}`;
}

export function elapsedSeconds(startedAt: string, now = new Date()): number {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) {
    return 0;
  }

  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
