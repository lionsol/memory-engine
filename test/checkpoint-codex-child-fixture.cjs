// Offline child-process fixture. Never launches Codex or requests a model.
const { spawn } = require("node:child_process");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", () => {
  if (process.env.CHECKPOINT_FIXTURE_MODE === "hang") {
    process.on("SIGTERM", () => {});
    // Inherit the pipe: parent-only termination cannot produce a close event.
    spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {
      stdio: ["ignore", process.stdout, process.stderr],
    });
    setInterval(() => {}, 1000);
    return;
  }
  const envelope = JSON.parse(input.slice(input.indexOf("\n") + 1));
  const packet = JSON.parse(envelope.source_packet);
  const summary = { version: packet.version, target_date: packet.target_date, binding: packet.binding,
    items: [{ topic: "离线回归", text: "子进程测试响应，非模型结果。",
      evidence: [packet.SOURCE.sources[0].units[0][0]], corrects: [] }] };
  for (const event of [{ type: "thread.started", thread_id: "offline-process" },
    { type: "turn.started" }, { type: "item.completed", item: { id: "answer",
      type: "agent_message", text: JSON.stringify(summary) } }, { type: "turn.completed" }]) {
    process.stdout.write(JSON.stringify(event) + "\n");
  }
});
