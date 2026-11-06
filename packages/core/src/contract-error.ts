export class ContractError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(`${code} at ${path}: ${message}`);
    this.name = "ContractError";
  }
}
