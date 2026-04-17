import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { rm } from "node:fs/promises";

const required_tools = ["create_collection", "create_environment", "create_request", "add_test_script", "create_test_suite", "create_crud_requests", "list_collections", "get_collection_stats"];

const container_collections_root = process.env.BRUNO_COLLECTIONS_ROOT || "/app/bruno_collections";
const host_collections_root = process.env.BRUNO_HOST_COLLECTIONS_PATH || "C:/Users/demo/Documents/bruno";
const test_collection_name = `mcp_full_tools_${Date.now()}`;
const test_collection_path = `${container_collections_root}/${test_collection_name}`;
const keep_test_collection = process.env.KEEP_TEST_COLLECTION === "1";

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

const ensure_success_response = (tool_name, response) => {
    if (response?.isError) {
        throw new Error(`${tool_name} returned MCP isError=true`);
    }

    const text = get_text_content(response);
    if (!text || text.trim().length === 0) {
        throw new Error(`${tool_name} returned empty output`);
    }

    if (text.includes("❌")) {
        throw new Error(`${tool_name} failed with message: ${text}`);
    }

    return text;
};

const call_tool = async (client, tool_name, args) => {
    const response = await client.callTool({
        name: tool_name,
        arguments: args,
    });

    const text = ensure_success_response(tool_name, response);
    console.log(`\n[${tool_name}]`);
    console.log(text);
    return text;
};

const test_cross_platform_path_resolution = async (client) => {
    const windows_style_root = host_collections_root;
    const linux_style_root = "/home/demo/bruno";
    const mac_style_root = "/Users/demo/bruno";

    await call_tool(client, "list_collections", { path: windows_style_root });
    await call_tool(client, "list_collections", { path: linux_style_root });
    await call_tool(client, "list_collections", { path: mac_style_root });

    const windows_style_collection = `${windows_style_root}/${test_collection_name}`;
    const linux_style_collection = `${linux_style_root}/${test_collection_name}`;
    const mac_style_collection = `${mac_style_root}/${test_collection_name}`;

    await call_tool(client, "get_collection_stats", { collectionPath: windows_style_collection });
    await call_tool(client, "get_collection_stats", { collectionPath: linux_style_collection });
    await call_tool(client, "get_collection_stats", { collectionPath: mac_style_collection });
};

const run = async () => {
    const client = new Client({
        name: "bruno_mcp_full_tools_test",
        version: "1.0.0",
    });

    let collection_created = false;

    try {
        await client.connect(create_transport());

        const tools_response = await client.listTools();
        const available_tools = tools_response.tools.map((tool) => tool.name);

        for (const required_tool of required_tools) {
            if (!available_tools.includes(required_tool)) {
                throw new Error(`Required tool is not available: ${required_tool}`);
            }
        }

        await call_tool(client, "create_collection", {
            name: test_collection_name,
            description: "full mcp tools smoke test",
            baseUrl: "https://example.com",
            outputPath: container_collections_root,
        });
        collection_created = true;

        await call_tool(client, "create_environment", {
            collectionPath: test_collection_path,
            name: "dev",
            variables: {
                base_url: "https://example.com/api",
                token: "demo-token",
                timeout: 30000,
            },
        });

        await call_tool(client, "create_request", {
            collectionPath: test_collection_path,
            name: "health check",
            method: "GET",
            url: "{{base_url}}/health",
            headers: {
                Accept: "application/json",
            },
            folder: "health",
            sequence: 1,
        });

        await call_tool(client, "add_test_script", {
            bruFilePath: `${test_collection_path}/health/health-check.bru`,
            scriptType: "tests",
            script: 'test("status should be 200", function () { expect(res.status).to.equal(200); });',
        });

        await call_tool(client, "create_test_suite", {
            collectionPath: test_collection_path,
            suiteName: "core_suite",
            requests: [
                {
                    name: "list users",
                    method: "GET",
                    url: "{{base_url}}/users",
                },
                {
                    name: "create user",
                    method: "POST",
                    url: "{{base_url}}/users",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: {
                        type: "json",
                        content: '{"name":"test user"}',
                    },
                },
            ],
        });

        await call_tool(client, "create_crud_requests", {
            collectionPath: test_collection_path,
            entityName: "widget",
            baseUrl: "{{base_url}}",
            folder: "crud_widget",
        });

        const list_output = await call_tool(client, "list_collections", {
            path: container_collections_root,
        });

        if (!list_output.includes(test_collection_name)) {
            throw new Error("list_collections did not include generated test collection");
        }

        const stats_output = await call_tool(client, "get_collection_stats", {
            collectionPath: test_collection_path,
        });

        if (!stats_output.includes("Total Requests:")) {
            throw new Error("get_collection_stats output is missing Total Requests");
        }

        await test_cross_platform_path_resolution(client);

        console.log("\nFull MCP tools test passed inside container.");
    } finally {
        await client.close().catch(() => undefined);

        if (collection_created && !keep_test_collection) {
            await rm(test_collection_path, { recursive: true, force: true }).catch(() => undefined);
        }
    }
};

run().catch((error) => {
    const error_message = error instanceof Error ? error.message : String(error);
    console.error(`Full MCP tools test failed: ${error_message}`);
    process.exit(1);
});
