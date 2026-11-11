import { installBdjKeyboardInput, installBdjPointerInput, startBdjRuntime } from "./bdj-runtime.js";

globalThis.__BDMV_BDJ_CLIENT__ = {
  start: startBdjRuntime,
  installKeyboardInput: installBdjKeyboardInput,
  installPointerInput: installBdjPointerInput,
};
