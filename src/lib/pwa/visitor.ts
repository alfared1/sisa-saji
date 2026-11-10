/**
 * First-visit flags read by "/":
 *  - "returning visitor": once someone has entered the customer app, "/" skips
 *    /tour and /welcome on the next visit;
 *  - "tour seen": once the /tour walkthrough was finished, skipped or left via
 *    a final CTA, a first-time guest lands on /welcome instead of the tour.
 */
import { readLocal, writeLocal } from "./storage";

const KEY = "ss-visited";
const TOUR_KEY = "ss-tour-seen";

export function markVisited(): void {
  if (readLocal(KEY) !== "1") writeLocal(KEY, "1");
}

export function hasVisited(): boolean {
  return readLocal(KEY) === "1";
}

export function markTourSeen(): void {
  if (readLocal(TOUR_KEY) !== "1") writeLocal(TOUR_KEY, "1");
}

export function hasSeenTour(): boolean {
  return readLocal(TOUR_KEY) === "1";
}
