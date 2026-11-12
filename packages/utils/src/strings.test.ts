import { expect, it } from "vitest";
import { equalsIgnoreCase } from "./strings.js";

it("compares strings without case", () => {
  expect(equalsIgnoreCase("AB123", "ab123")).toBe(true);
  expect(equalsIgnoreCase("AB123", "ab124")).toBe(false);
});
