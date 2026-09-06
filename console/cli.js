import { createServer, DEFAULT_CONSOLE_HOST } from "./server.js";
import { initConsoleStorage } from "./services/db.js";
import { createConsoleSecurityPolicy } from "./security.js";

const port = Number(process.env.MEMORY_CONSOLE_PORT || 8787);
const host = process.env.MEMORY_CONSOLE_HOST || DEFAULT_CONSOLE_HOST;

try {
  if (process.argv.includes("--check")) {
    createConsoleSecurityPolicy({ bindHost: host, port });
    initConsoleStorage();
    console.log("Memory Console Lite check ok");
  } else {
    const server = await createServer({ host, port });
    server.listen(port, host, () => {
      console.log(`Memory Console Lite running at http://${host}:${port}/`);
    });
  }
} catch (error) {
  console.error(`[memory-console] ${error?.message || error}`);
  process.exitCode = 1;
}
