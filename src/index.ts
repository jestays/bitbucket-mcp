#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error("[bitbucket-mcp] Fatal error in startServer():", error);
  process.exit(1);
});
