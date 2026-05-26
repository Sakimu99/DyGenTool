export function extractFirstUrl(input: string): string {
  const match = input.match(/https?:\/\/[^\s，。]+/i);
  return match?.[0] ?? '';
}
