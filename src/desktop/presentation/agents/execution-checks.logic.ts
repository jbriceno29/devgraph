/** How long a check took, as Revisión shows it: «0,8 s», «42 s», «3 min 5 s». */
export function checkDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ''}`;
}
