"use strict";

/**
 * Smoke tests for the third-party libraries the adapter depends on.
 * They run without API keys or a running ioBroker and are meant to catch breaking changes on dependency updates.
 */

const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("dependency smoke tests", function () {
	// first imports of the AI SDKs can be slow (e.g. on Windows with virus scanning)
	this.timeout(30000);

	describe("OpenAiVectorDB (better-sqlite3 + sqlite-vec)", () => {
		let tmpDir;
		let db;

		before(async () => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-test-"));
			const { OpenAiVectorDB } = await import("./openai-sqlite-vectorize.mjs");
			db = new OpenAiVectorDB({ apiKey: "test", dbPath: tmpDir, dimensionality: 3, logger: silentLogger() });
			// fake embeddings: no network access
			const vectors = { lamp: [1, 0, 0], heater: [0, 1, 0], query: [0.9, 0.1, 0] };
			db._getEmbedding = async (text) => new Float32Array(vectors[text]);
			await db.init();
		});

		after(() => {
			db && db.close();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("writes, finds, updates and deletes items", async () => {
			await db.write("hue.0.lamp.on", "lamp", { type: "state" });
			await db.write("heating.0.heater.on", "heater", { type: "state" });
			await db.write("hue.0.lamp.on", "lamp", { type: "state", updated: true });

			const results = await db.find("query", 2);
			expect(results).to.have.length(2);
			expect(results[0].id).to.equal("hue.0.lamp.on");
			expect(results[0].metadata).to.deep.equal({ type: "state", updated: true });

			expect(await db.deleteItem("hue.0.lamp.on")).to.equal(true);
			expect(await db.deleteItem("hue.0.lamp.on")).to.equal(false);
			const remaining = await db.find("query", 10);
			expect(remaining.map((r) => r.id)).to.deep.equal(["heating.0.heater.on"]);
		});

		it("can be created without API key and fails only on embedding", async () => {
			const { OpenAiVectorDB } = await import("./openai-sqlite-vectorize.mjs");
			const noKey = new OpenAiVectorDB({ dbPath: tmpDir, logger: silentLogger() });
			await expect(noKey._getEmbedding("lamp")).to.be.rejectedWith(/No API key configured/);
		});
	});

	describe("MCP tools (@modelcontextprotocol/sdk + zod + @google/genai)", () => {
		let client;
		let toolNames;

		before(async () => {
			const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { DirectTransport, DirectClientTransport } = await import("./mcp-direct-transport.mjs");
			/** @type {Record<string, any>} */
			const Tools = (await import("./tools/allTools.mjs")).Tools;

			toolNames = Object.values(Tools).map((t) => t.name);
			const server = new McpServer({ name: "kiwi-test", version: "0.0.0" });
			for (const tool of Object.values(Tools)) {
				server.tool(tool.name, tool.desc, tool.params, tool.call({}));
			}
			const serverTransport = new DirectTransport();
			await server.connect(serverTransport);
			client = new Client({ name: "kiwi-test-client", version: "0.0.0" });
			await client.connect(new DirectClientTransport(serverTransport));
		});

		after(async () => {
			client && (await client.close());
		});

		it("lists every registered tool with a JSON schema", async () => {
			const { tools } = await client.listTools();
			expect(tools.map((t) => t.name)).to.have.members(toolNames);
			for (const tool of tools) {
				expect(tool.inputSchema, tool.name).to.include({ type: "object" });
			}
		});

		it("validates arguments and calls the API", async () => {
			const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
			/** @type {Record<string, any>} */
			const Tools = (await import("./tools/allTools.mjs")).Tools;

			const calls = [];
			const API = { setObject: async (args) => (calls.push(args), { status: "ok" }) };
			const server = new McpServer({ name: "kiwi-test", version: "0.0.0" });
			for (const tool of Object.values(Tools)) {
				server.tool(tool.name, tool.desc, tool.params, tool.call(API));
			}
			const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
			await server.connect(serverSide);
			const callClient = new Client({ name: "kiwi-test-client", version: "0.0.0" });
			await callClient.connect(clientSide);
			try {
				const obj = { type: "state", common: { name: "test" }, native: {} };
				const res = await callClient.callTool({ name: "setObject", arguments: { id: "kiwi.0.test", obj } });
				expect(res.isError, JSON.stringify(res)).to.not.equal(true);
				expect(calls).to.deep.equal([{ id: "kiwi.0.test", obj }]);

				const invalid = await callClient.callTool({ name: "setObject", arguments: { id: "kiwi.0.test" } });
				expect(invalid.isError).to.equal(true);
			} finally {
				await callClient.close();
			}
		});

		it("can be converted to Gemini tools", async () => {
			const { mcpToTool } = await import("@google/genai");
			const geminiTool = mcpToTool(client);
			const { functionDeclarations } = await geminiTool.tool();
			expect((functionDeclarations || []).map((f) => f.name)).to.have.members(toolNames);
		});
	});

	describe("mingo", () => {
		it("filters objects with MongoDB style queries", async () => {
			const { Query } = await import("mingo");
			const objects = [
				{ _id: "a", type: "state", common: { role: "switch" } },
				{ _id: "b", type: "channel", common: {} },
				{ _id: "c", type: "state", common: { role: "value.temperature" } },
			];
			const res = new Query({ type: "state", "common.role": { $regex: "^value" } }).find(objects).all();
			expect(res.map((o) => o._id)).to.deep.equal(["c"]);
		});
	});
});

function silentLogger() {
	const noop = () => {};
	return { debug: noop, info: noop, warn: noop, error: noop };
}
