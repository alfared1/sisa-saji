"use client";

import { useNow } from "./use-now";

/** Blueprint: pins/badges turn urgent (red, pulsing) under 45 minutes to close. */
export const URGENT_THRESHOLD_MINUTES = 45;

export type Countdown = {
  /** False on the server / first client render (no clock yet). */
  ready: boolean;
  totalSeconds: number;
  /** Whole minutes remaining (e.g. 83 for 01:23:45). */
  totalMinutes: number;
  hours: number;
  /** 0–59 */
  minutes: number;
  /** 0–59 */
  seconds: number;
  /** "01:23:45" (or "23:45" when under an hour and `compact`). */
  label: string;
  isUrgent: boolean;
  isOver: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function computeCountdown(
  targetIso: string | null | undefined,
  nowMs: number | null,
  urgentMinutes = URGENT_THRESHOLD_MINUTES,
): Countdown {
  const target = targetIso ? Date.parse(targetIso) : NaN;
  if (nowMs === null || !Number.isFinite(target)) {
    return {
      ready: false,
      totalSeconds: 0,
      totalMinutes: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      label: "--:--:--",
      isUrgent: false,
      isOver: false,
    };
  }
  const total = Math.max(0, Math.floor((target - nowMs) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return {
    ready: true,
    totalSeconds: total,
    totalMinutes: Math.floor(total / 60),
    hours,
    minutes,
    seconds,
    label: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
    isUrgent: total > 0 && total < urgentMinutes * 60,
    isOver: total === 0,
  };
}

/** 1-second countdown to an ISO timestamp. */
export function useCountdown(targetIso: string | null | undefined, urgentMinutes = URGENT_THRESHOLD_MINUTES): Countdown {
  const now = useNow(1000);
  return computeCountdown(targetIso, now, urgentMinutes);
}
