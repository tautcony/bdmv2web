/** Compare strings after lowercasing with the en-US locale. */
export function equalsIgnoreCase(left: string, right: string): boolean {
  return left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US");
}
