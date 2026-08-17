import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const forbidden = ["DISCORD_BOT_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "service_role"];

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

for (const path of await files("dist")) {
  const content = await readFile(path, "utf8");
  const leaked = forbidden.find((value) => content.includes(value));
  if (leaked) throw new Error(`Secret identifier found in frontend build: ${leaked}`);
}

console.log("Frontend build contains no server-side secret identifiers.");
