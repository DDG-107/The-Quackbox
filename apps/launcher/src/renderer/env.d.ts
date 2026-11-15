/// <reference types="vite/client" />

import type { QuackboxApi } from "../shared/api.js";

declare global {
  interface Window {
    quackbox?: QuackboxApi;
  }
}

export {};
