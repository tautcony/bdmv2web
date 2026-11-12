export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorDescription(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
