/**
 * "Returning visitor" flag: once someone has entered the customer app, "/"
 * skips the /welcome screen on the next visit.
 */
import { readLocal, writeLocal } from "./storage";

const KEY = "ss-visited";

export function markVisited(): void {
  if (readLocal(KEY) !== "1") writeLocal(KEY, "1");
}

export function hasVisited(): boolean {
  return readLocal(KEY) === "1";
}
