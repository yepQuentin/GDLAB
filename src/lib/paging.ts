export function parsePageNumber(input?: string): number {
  if (!input) {
    return 1;
  }

  const page = Number(input);
  if (!Number.isInteger(page) || page < 1) {
    return 1;
  }

  return page;
}
