/**
 * What the screens show before anyone has touched the control panel, and what "Reset" goes back to.
 * Everything here can be changed live from /control; edit this file to change the starting point.
 */
export const config = {
  eventName: "Haven London",
  /** Clocks and the schedule's "now" marker always use this zone, whatever the screen's own clock says. */
  timeZone: "Europe/London",
};

export const defaults = {
  /** idle | schedule | countdown | message | embed | rotate */
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

  /** Cycles through these scenes; every screen switches at the same moment. */
  rotate: {
    seconds: 20,
    scenes: ["idle", "schedule", "countdown"],
  },

  /** A scrolling strip along the bottom, on top of whatever scene is showing. */
  ticker: {
    enabled: false,
    text: "",
  },

  /** A temporary full-screen announcement. Set from the control panel; null when nothing is flashing. */
  alert: null,
};
