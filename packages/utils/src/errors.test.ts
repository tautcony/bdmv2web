import { expect, it } from "vitest";
import { errorDescription, errorText } from "./index.js";

it("formats error objects and other thrown values", () => {
  const error = new TypeError("invalid value");
  expect(errorText(error)).toBe("invalid value");
  expect(errorDescription(error)).toBe("TypeError: invalid value");
  expect(errorText("failure")).toBe("failure");
  expect(errorDescription("failure")).toBe("failure");
});
