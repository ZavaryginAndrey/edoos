// npm run mcp:inspect — поднимает все включённые MCP-серверы из src/mcp/servers.config.ts как отдельные процессы
// (stdio), подключается к каждому стандартным MCP-клиентом и печатает, что он умеет: tools с параметрами,
// пометки конфига (что коуч видит всегда, что только после approve, что скрыто) и resources.
// Ни DeepSeek, ни агент здесь не участвуют — это взгляд на серверы глазами любого MCP-клиента.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { MCP_SERVERS, type McpServerConfig } from "../src/mcp/servers.config";

type JsonSchema = { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };

function formatParams(schema: JsonSchema): string {
  const entries = Object.entries(schema.properties ?? {});
  if (!entries.length) return "      параметров нет";
  return entries
    .map(([name, prop]) => {
      const required = schema.required?.includes(name) ? "" : "?";
      const description = prop.description ? ` — ${prop.description.split("\n")[0].slice(0, 100)}` : "";
      return `      ${name}${required}: ${prop.type ?? "any"}${description}`;
    })
    .join("\n");
}

// Та же логика, что у configToolFilter в src/mcp/servers.ts, но словами.
function visibility({ tools = {} }: McpServerConfig, name: string): string {
  const { allow, block = [], afterApprove = [] } = tools;
  if ((allow && !allow.includes(name)) || block.includes(name)) return "скрыт от коуча";
  if (afterApprove === "*" || afterApprove.includes(name)) return "после approve";
  return "виден коучу";
}

async function inspect(config: McpServerConfig) {
  const client = new Client({ name: "mcp-inspect", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: config.command, args: config.args, env: config.env, cwd: process.cwd(), stderr: "ignore",
  });
  try {
    await client.connect(transport);
    const info = client.getServerVersion();
    const mode = config.button ? `по кнопке «${config.button.label}»` : "в каждом запуске";
    console.log(`\n=== [${config.name}] ${info?.name} ${info?.version} — ${mode}`);
    console.log(`    ${config.command === process.execPath ? "node" : config.command} ${config.args.join(" ")}`);

    const { tools } = await client.listTools();
    console.log(`\n  Tools (${tools.length}):`);
    for (const tool of tools) {
      const mark = visibility(config, tool.name);
      // Так имя видит модель: SDK заменяет «-» на «_» и в имени сервера, и в имени tool.
      console.log(`\n    mcp_${config.name.replace(/-/g, "_")}__${tool.name.replace(/-/g, "_")}  [${mark}]`);
      if (mark !== "скрыт от коуча") console.log(formatParams(tool.inputSchema as JsonSchema));
    }

    const resources = client.getServerCapabilities()?.resources ? (await client.listResources()).resources : [];
    if (resources.length) {
      console.log(`\n  Resources (${resources.length}):`);
      for (const resource of resources) console.log(`    ${resource.uri.padEnd(16)} ${resource.title ?? resource.name}`);
    }
  } catch (error) {
    console.log(`\n=== [${config.name}] не запустился: ${error instanceof Error ? error.message : error}`);
  } finally {
    await client.close();
  }
}

const enabled = MCP_SERVERS.filter((server) => server.enabled);
const disabled = MCP_SERVERS.filter((server) => !server.enabled).map((server) => server.name);
console.log(`Включены: ${enabled.map((server) => server.name).join(", ")}${disabled.length ? `; выключены: ${disabled.join(", ")}` : ""}`);
for (const config of enabled) await inspect(config);
