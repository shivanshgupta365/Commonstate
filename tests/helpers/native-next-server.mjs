import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { fileURLToPath } from "node:url";

const nextCli = fileURLToPath(
  new URL("../../node_modules/next/dist/bin/next", import.meta.url),
);

async function openPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a native Next test port.")));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export async function startNativeNextServer({ hostname = "127.0.0.1" } = {}) {
  const port = await openPort();
  const connectHostname = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
  const origin = `http://${connectHostname}:${port}`;
  const child = spawn(
    process.execPath,
    [nextCli, "start", "--hostname", hostname, "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        COMMONSTATE_TEST_MEMORY:
          process.env.COMMONSTATE_TEST_MEMORY ??
          (process.env.DATABASE_URL ? "0" : "1"),
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let logs = "";
  const collect = (chunk) => {
    logs = `${logs}${chunk.toString()}`.slice(-20_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Native Next server exited with ${child.exitCode} before readiness.\n${logs}`,
      );
    }
    try {
      const response = await fetch(
        `${origin}/api/demo/state?workspace=native-server-readiness`,
        { headers: { accept: "application/json" } },
      );
      if (response.ok) {
        return {
          origin,
          logs: () => logs,
          async stop() {
            if (child.exitCode !== null) return;
            child.kill("SIGTERM");
            await Promise.race([
              new Promise((resolve) => child.once("exit", resolve)),
              new Promise((resolve) => setTimeout(resolve, 5_000)),
            ]);
            if (child.exitCode === null) child.kill("SIGKILL");
          },
        };
      }
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  child.kill("SIGKILL");
  throw new Error(`Timed out waiting for native Next at ${origin}.\n${logs}`);
}
