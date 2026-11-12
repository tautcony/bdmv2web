import { expect, it } from "vitest";
import { isRecord } from "./object.js";

it("identifies non-null objects that are not arrays", () => {
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord(null)).toBe(false);
  expect(isRecord([])).toBe(false);
  expect(isRecord("value")).toBe(false);
});
