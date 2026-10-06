// Chat engines for the integrated chat bot. Both expose the MCP tools of the local MCP client to the model.
import OpenAI from "openai";
import { GoogleGenAI, mcpToTool } from "@google/genai";

// upper bound of model <-> tool round trips for one prompt
const MAX_TOOL_ROUNDS = 20;

export class GeminiChat {
	/**
	 * @param {{ apiKey: string, model: string, temperature: number, systemPrompt: string, mcpClient: any }} options
	 */
	constructor(options) {
		this.options = options;
		this.genAI = new GoogleGenAI({ apiKey: options.apiKey });
		this.chat = this._createChat();
	}

	reset() {
		this.chat = this._createChat();
	}

	_createChat() {
		const { model, temperature, systemPrompt, mcpClient } = this.options;
		return this.genAI.chats.create({
			model,
			config: {
				// mcpToTool lets the SDK call the MCP tools automatically
				tools: [mcpToTool(mcpClient)],
				temperature,
				systemInstruction: systemPrompt,
				thinkingConfig: {
					includeThoughts: true,
				},
			},
			history: [],
		});
	}

	async prompt(text) {
		const response = await this.chat.sendMessage({ message: text });
		return response.text;
	}

	async promptStream(text, onChunk) {
		const response = await this.chat.sendMessageStream({ message: text });
		for await (const chunk of response) {
			onChunk(chunk);
		}
	}
}

export class OpenAiChat {
	/**
	 * @param {{ apiKey: string, model: string, temperature: number, systemPrompt: string, mcpClient: any, logger?: any }} options
	 */
	constructor(options) {
		this.options = options;
		this.logger = options.logger || console;
		this.client = new OpenAI({ apiKey: options.apiKey });
		this.tools = null;
		// reasoning models reject `temperature`; switched off after the first such error
		this.useTemperature = options.temperature !== undefined && options.temperature !== null;
		this.reset();
	}

	reset() {
		// the conversation is kept by OpenAI and continued via previous_response_id
		this.previousResponseId = undefined;
	}

	async _getTools() {
		if (!this.tools) {
			const { tools } = await this.options.mcpClient.listTools();
			this.tools = tools.map((tool) => {
				// eslint-disable-next-line no-unused-vars
				const { $schema, ...parameters } = tool.inputSchema || { type: "object", properties: {} };
				return {
					type: "function",
					name: tool.name,
					description: tool.description || "",
					parameters,
					strict: false,
				};
			});
		}
		return this.tools;
	}

	async _createResponse(params) {
		/** @type {any} */
		const body = {
			model: this.options.model,
			instructions: this.options.systemPrompt,
			tools: await this._getTools(),
			...params,
		};
		if (this.useTemperature) {
			body.temperature = this.options.temperature;
		}
		try {
			return await this.client.responses.create(body);
		} catch (e) {
			if (this.useTemperature && e && e.status === 400 && /temperature/i.test(String(e.message))) {
				this.logger.info(`[Kiwi Chat] Model ${this.options.model} does not support temperature, ignoring it.`);
				this.useTemperature = false;
				return this._createResponse(params);
			}
			throw e;
		}
	}

	async _callTool(call) {
		try {
			const args = call.arguments ? JSON.parse(call.arguments) : {};
			const result = await this.options.mcpClient.callTool({ name: call.name, arguments: args });
			const text = (result.content || []).map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
			return result.isError ? `Error: ${text}` : text;
		} catch (e) {
			return `Error calling tool ${call.name}: ${e.message}`;
		}
	}

	async prompt(text) {
		/** @type {any[]} */
		let input = [{ role: "user", content: text }];
		for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
			const response = await this._createResponse({ input, previous_response_id: this.previousResponseId });
			this.previousResponseId = response.id;

			const calls = response.output.filter((item) => item.type === "function_call");
			if (!calls.length) {
				return response.output_text;
			}
			input = await Promise.all(
				calls.map(async (call) => ({
					type: "function_call_output",
					call_id: call.call_id,
					output: await this._callTool(call),
				})),
			);
		}
		throw new Error(`Stopped after ${MAX_TOOL_ROUNDS} tool call rounds without a final answer.`);
	}

	async promptStream(text, onChunk) {
		// no streaming for the tool loop yet: deliver the final answer as a single chunk
		onChunk({ text: await this.prompt(text) });
	}
}
