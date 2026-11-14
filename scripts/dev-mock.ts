/** Runs Telecast locally against the pretend Slack in mock-slack.ts. For development only. */
import { MOCK_SLACK_PORT } from "./mock-slack.ts";

Object.assign(process.env, {
  SLACK_BASE_URL: `http://localhost:${MOCK_SLACK_PORT}`,
  SLACK_CLIENT_ID: "mock",
  SLACK_CLIENT_SECRET: "mock",
  SLACK_BOT_TOKEN: "mock",
  TELECAST_ADMINS: "U_ADA",
  DATA_DIR: process.env.DATA_DIR ?? "data/mock",
});

await import("../dist/server.cjs" as string);
