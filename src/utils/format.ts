export function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0:00';
  if (ms >= 8640000000000) return '🔴 Live Stream';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;

  if (hours > 0) {
    const paddedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

export function formatDurationVerbose(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function createProgressBar(currentMs: number, totalMs: number, barLength = 15): string {
  if (totalMs <= 0) {
    return '▬'.repeat(barLength);
  }

  const ratio = Math.max(0, Math.min(1, currentMs / totalMs));
  const progress = Math.round(barLength * ratio);
  const empty = barLength - progress;

  const filledBar = '▬'.repeat(Math.max(0, progress - 1));
  const emptyBar = '▬'.repeat(Math.max(0, empty));

  return `${filledBar}🔘${emptyBar}`;
}
