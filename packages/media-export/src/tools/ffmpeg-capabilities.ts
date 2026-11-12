export function hasEncoder(text: string, name: string): boolean {
  return text.split(/\r?\n/).some((line) => /^\s*[VAS.D]{6}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === name);
}

export function hasFilter(text: string, name: string): boolean {
  return text.split(/\r?\n/).some((line) => /^\s*[TSC.]{2,3}\s+/.test(line) && line.trim().split(/\s+/, 2)[1] === name);
}
