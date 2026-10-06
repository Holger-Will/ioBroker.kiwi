"use strict";

/**
 * Tests for the AI provider selection and the chat engines.
 * The "live" suite runs only when an OpenAI key is available (env OPENAI_API_KEY or OpenAI_API_KEY in .env).
 */

const { expect } = require("chai");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("AI provider", function () {
	// first imports of the AI SDKs can be slow (e.g. on Windows with virus scanning)
	this.timeout(30000);

	let provider;
	before(async () => {
		provider = await import("./ai-provider.mjs");
	});

	it("defaults to OpenAI", () => {
		expect(provider.DEFAULT_PROVIDER).to.equal("openai");
		expect(provider.normalizeProvider(undefined)).to.equal("openai");
		expect(provider.normalizeProvider("unknown")).to.equal("openai");
		expect(provider.normalizeProvider("gemini")).to.equal("gemini");
	});

	it("keeps a matching model and replaces a model of the other provider", () => {
		expect(provider.resolveModel("openai", "gpt-5.4")).to.equal("gpt-5.4");
		expect(provider.resolveModel("openai", "gemini-2.5-flash-preview-05-20")).to.equal("gpt-5-mini");
		expect(provider.resolveModel("openai", "")).to.equal("gpt-5-mini");
		expect(provider.resolveModel("gemini", "models/gemini-2.5-pro")).to.equal("models/gemini-2.5-pro");
		expect(provider.resolveModel("gemini", "gpt-5-mini")).to.equal("gemini-2.5-flash");
	});

	it("filters OpenAI models to chat models", () => {
		const isModel = provider.PROVIDERS.openai.isModel;
		for (const id of ["gpt-5-mini", "gpt-5.4", "o3", "o4-mini", "gpt-5.1-codex"]) {
			expect(isModel(id), id).to.equal(true);
		}
		for (const id of ["gpt-image-1", "gpt-realtime", "gpt-audio", "text-embedding-3-large", "whisper-1"]) {
			expect(isModel(id), id).to.equal(false);
		}
	});

	describe("vector store per provider", () => {
		let tmpDir;
		before(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-test-"));
		});
		after(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("uses separate files and fails only on embedding without API key", async () => {
			const logger = silentLogger();
			const openai = provider.createVectorDB({ provider: "openai", dbPath: tmpDir, logger });
			const gemini = provider.createVectorDB({ provider: "gemini", dbPath: tmpDir, logger });
			expect(openai.dbFilePath).to.not.equal(gemini.dbFilePath);
			expect(openai.dimensionality).to.equal(3072);
			expect(gemini.dimensionality).to.equal(768);
			expect(gemini.modelName).to.equal("gemini-embedding-001");

			await gemini.init();
			expect(gemini.has("a.0.b")).to.equal(false);
			await expect(gemini.get_index_vectors("lamp")).to.be.rejectedWith(/No API key configured/);
			gemini.close();
		});
	});

	describe("OpenAiChat tool loop (fake OpenAI client)", () => {
		it("calls MCP tools until the model answers and drops unsupported temperature", async () => {
			const { OpenAiChat } = await import("./chat-engines.mjs");
			const toolCalls = [];
			const mcpClient = {
				listTools: async () => ({
					tools: [
						{
							name: "getIobrokerState",
							description: "get a state",
							inputSchema: { $schema: "x", type: "object", properties: { id: { type: "string" } } },
						},
					],
				}),
				callTool: async (req) => {
					toolCalls.push(req);
					return { content: [{ type: "text", text: '{"val":21.5}' }] };
				},
			};
			/** @type {any} */
			const chat = new OpenAiChat({
				apiKey: "test",
				model: "o3",
				temperature: 0.2,
				systemPrompt: "sys",
				mcpClient,
				logger: silentLogger(),
			});

			const requests = [];
			chat.client = {
				responses: {
					create: async (body) => {
						requests.push(body);
						if (body.temperature !== undefined) {
							const err = new Error("Unsupported parameter: 'temperature'");
							// @ts-ignore
							err.status = 400;
							throw err;
						}
						if (requests.filter((r) => r.temperature === undefined).length === 1) {
							return {
								id: "resp_1",
								output: [
									{
										type: "function_call",
										call_id: "call_1",
										name: "getIobrokerState",
										arguments: '{"id":"t.0.temp"}',
									},
								],
							};
						}
						return { id: "resp_2", output: [{ type: "message" }], output_text: "It is 21.5 °C." };
					},
				},
			};

			const answer = await chat.prompt("How warm is it?");
			expect(answer).to.equal("It is 21.5 °C.");
			expect(toolCalls).to.deep.equal([{ name: "getIobrokerState", arguments: { id: "t.0.temp" } }]);

			const sent = requests.filter((r) => r.temperature === undefined);
			expect(sent[0].tools[0]).to.include({ type: "function", name: "getIobrokerState" });
			expect(sent[0].tools[0].parameters).to.not.have.property("$schema");
			expect(sent[1].previous_response_id).to.equal("resp_1");
			expect(sent[1].input).to.deep.equal([
				{ type: "function_call_output", call_id: "call_1", output: '{"val":21.5}' },
			]);
			expect(chat.previousResponseId).to.equal("resp_2");
		});
	});

	const apiKey = readOpenAiKey() || "";
	(apiKey ? describe : describe.skip)("live OpenAI (needs API key)", function () {
		this.timeout(120000);
		let tmpDir;
		before(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-live-"));
		});
		after(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		it("lists chat models", async () => {
			const models = await provider.listChatModels("openai", apiKey);
			expect(models.map((m) => m.value)).to.include("gpt-5-mini");
		});

		it("indexes and finds states semantically", async () => {
			const db = provider.createVectorDB({ provider: "openai", apiKey, dbPath: tmpDir, logger: silentLogger() });
			await db.init();
			try {
				await db.write("hue.0.livingroom.on", "Deckenlampe im Wohnzimmer, an/aus", { type: "state" });
				await db.write("heating.0.bath.temp", "Temperatur im Badezimmer", { type: "state" });
				const [best] = await db.find("switch on the living room light", 2);
				expect(best.id).to.equal("hue.0.livingroom.on");
			} finally {
				db.close();
			}
		});

		it("answers using an MCP tool", async () => {
			const { OpenAiChat } = await import("./chat-engines.mjs");
			const toolCalls = [];
			const mcpClient = {
				listTools: async () => ({
					tools: [
						{
							name: "getIobrokerState",
							description: "Get the current value of an ioBroker state by its id.",
							inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
						},
					],
				}),
				callTool: async (req) => {
					toolCalls.push(req);
					return { content: [{ type: "text", text: JSON.stringify({ val: 21.5, unit: "°C" }) }] };
				},
			};
			const chat = new OpenAiChat({
				apiKey,
				model: "gpt-5-mini",
				temperature: 0.2,
				systemPrompt: "You control an ioBroker system. Use the tools.",
				mcpClient,
				logger: silentLogger(),
			});
			const answer = await chat.prompt("What is the value of the state heating.0.bath.temp?");
			expect(toolCalls.map((c) => c.arguments.id)).to.include("heating.0.bath.temp");
			expect(answer).to.match(/21[.,]5/);
		});
	});
});

function readOpenAiKey() {
	if (process.env.OPENAI_API_KEY) {
		return process.env.OPENAI_API_KEY;
	}
	try {
		const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
		const match = env.match(/^OPENAI_API_KEY=(.+)$/im);
		return match ? match[1].trim() : undefined;
	} catch {
		return undefined;
	}
}

function silentLogger() {
	const noop = () => {};
	return { debug: noop, info: noop, warn: noop, error: noop };
}
