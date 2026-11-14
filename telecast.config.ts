/**
 * Everything specific to one event. To run Telecast for a different event, change this file and
 * swap the files in public/theme/ (logo, background, mascot, stickers, colours and fonts).
 */
import type { TelecastConfig } from "./src/shared/types.ts";

const config: TelecastConfig = {
  eventName: "Haven London",
  timeZone: "Europe/London",

  stickers: [
    ...Array.from({ length: 11 }, (_, i) => `/theme/stickers/sticker${i + 1}.webp`),
    "/theme/stickers/flag.svg",
  ],
  mascot: true,

  defaults: {
    scene: "idle",

    idle: {
      message: "Welcome to Haven London!",
      showNext: true,
      stickers: true,
    },

    message: {
      kicker: "Announcement",
      title: "Lunch is ready",
      body: "Pizza in the main hall.",
      tone: "orange",
    },

    countdown: {
      label: "Hacking ends in",
      target: Date.parse("2026-11-14T17:00:00Z"),
      doneText: "Time's up!",
    },

    embed: {
      url: "",
      showClock: false,
    },

    schedule: {
      title: "Haven Line",
      platform: "Platform 1",
      items: [
        { time: "9:00", title: "doors open", detail: "Come and get set up!" },
        { time: "9:45", title: "opening ceremony", detail: "" },
        { time: "10:15", title: "form teams & start building", detail: "" },
        { time: "10:45", title: "workshops start", detail: "" },
        { time: "11:30", title: "lunch!", detail: "" },
        { time: "13:00", title: "lightning talks", detail: "" },
        { time: "16:30", title: "dinner", detail: "" },
        { time: "17:00", title: "ship projects", detail: "" },
        { time: "17:30", title: "project demos & voting", detail: "" },
        { time: "18:30", title: "closing ceremony", detail: "" },
        { time: "19:30", title: "home time", detail: "" },
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
