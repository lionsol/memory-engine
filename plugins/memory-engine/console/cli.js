import { createServer } from "./server.js";
import { initConsoleStorage } from "./services/db.js";

const port = Number(process.env.MEMORY_CONSOLE_PORT || 8787);
const host = process.env.MEMORY_CONSOLE_HOST || "0.0.0.0";

if (process.argv.includes("--check")) {
  initConsoleStorage();
  console.log("Memory Console Lite check ok");
} else {
  const server = await createServer();
  server.listen(port, host, () => {
    console.log(`Memory Console Lite running at http://${host}:${port}/`);
  });
}
