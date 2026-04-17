import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const create_transport = () => {
    return new StdioClientTransport({
        command: "node",
        args: ["--loader", "ts-node/esm/transpile-only", "src/index.ts"],
    });
};

const get_text_content = (response) => {
    const text_items = (response.content || []).filter((item) => item.type === "text" && item.text);
    return text_items.map((item) => item.text).join("\n");
};

const run = async () => {
    const collections_path = "/app/bruno_collections";
    const client = new Client({
        name: "bruno_mcp_docker_test",
        version: "1.0.0",
    });

    try {
        await client.connect(create_transport());

        const tools = await client.listTools();
        const has_list_collections = tools.tools.some((tool) => tool.name === "list_collections");

        if (!has_list_collections) {
            throw new Error("Tool list_collections is not available");
        }

        const list_response = await client.callTool({
            name: "list_collections",
            arguments: {
                path: collections_path,
            },
        });

        const list_text = get_text_content(list_response);
        console.log("list_collections response:");
        console.log(list_text);

        if (!list_text || list_text.trim().length === 0) {
            throw new Error("list_collections returned empty output");
        }

        console.log(`MCP docker test passed. list_collections ejecutado en ${collections_path}`);
    } finally {
        await client.close().catch(() => undefined);
    }
};

run().catch((error) => {
    const error_message = error instanceof Error ? error.message : String(error);
    console.error(`MCP docker test failed: ${error_message}`);
    process.exit(1);
});
