/** Runs Telecast locally against the pretend Hack Club Auth in mock-hackclub.ts. For development only. */
import { MOCK_ADMIN_EMAIL, MOCK_HACKCLUB_PORT } from "./mock-hackclub.ts";

Object.assign(process.env, {
  HACKCLUB_AUTH_URL: `http://localhost:${MOCK_HACKCLUB_PORT}`,
  HACKCLUB_CLIENT_ID: "mock",
  HACKCLUB_CLIENT_SECRET: "mock",
  TELECAST_ADMINS: MOCK_ADMIN_EMAIL,
  DATA_DIR: process.env.DATA_DIR ?? "data/mock",
});

await import("../dist/server.cjs" as string);
