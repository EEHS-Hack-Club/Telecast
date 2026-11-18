/**
 * Everything specific to one event. To run Telecast for a different event, change this file and
 * swap the files in public/theme/ (logo, background, mascot, stickers, colours and fonts).
 */
import type { TelecastConfig } from "./src/shared/types.ts";

const config: TelecastConfig = {
  eventName: "EEHS Hack Club",
  timeZone: "Europe/London",

  stickers: [
    ...Array.from({ length: 11 }, (_, i) => `/theme/stickers/sticker${i + 1}.webp`),
    "/theme/stickers/flag.svg",
  ],
  mascot: false,

  defaults: {
    scene: "idle",

    idle: {
      message: "Welcome to EEHS Hack Club!",
      showNext: true,
      stickers: true,
    },

    message: {
      kicker: "Announcement",
      title: "Snacks are out",
      body: "Help yourself at the front.",
      tone: "red",
    },

    countdown: {
      label: "Show & tell in",
      target: Date.parse("2026-12-02T16:40:00Z"),
      doneText: "Time's up!",
    },

    embed: {
      url: "",
      showClock: false,
    },

    schedule: {
      title: "EEHS Hack Club",
      platform: "Today",
      items: [
        { time: "15:30", title: "doors open", detail: "Grab a seat and a snack" },
        { time: "15:40", title: "what's new", detail: "" },
        { time: "15:50", title: "build time", detail: "Work on your project" },
        { time: "16:40", title: "show & tell", detail: "" },
        { time: "17:00", title: "home time", detail: "" },
      ],
    },

    rotate: {
      seconds: 20,
      scenes: ["idle", "schedule", "countdown"],
    },

    ticker: {
      enabled: false,
      text: "",
    },
  },
};

export default config;
