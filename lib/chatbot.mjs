/* eslint import/no-unresolved: "off" */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DirectTransport, DirectClientTransport } from "./mcp-direct-transport.mjs";
import { Tools } from "./tools/allTools.mjs";
import { ioBrokerAdapterApi } from "./api_adapter.mjs";
import { normalizeProvider, resolveModel } from "./ai-provider.mjs";
import { GeminiChat, OpenAiChat } from "./chat-engines.mjs";

const DEFAULT_SYSTEM_PROMPT = `Your Name is Kiwi. You are a helpful assistant, helping control and maintain the user's ioBroker system.
                        You have access to several tools to help you fulfill user requests and provide accurate information.
                        Use the search tool to find states in ioBroker you can interact with, like switching lights on and off or reading temperatures.
                        All other tools are for administrative purposes, like discovering and describing states that are not in the semantic search index yet,
                        or creating scripts that run on the ioBroker server etc.
                        For discovering new devices and states etc. for administrative purposes, use the appropriate tools.`;

export class Chatbot {
	constructor(options) {
		this.options = options || {};
		this.provider = normalizeProvider(options.provider);
		this.modelName = resolveModel(this.provider, options.modelName);
		this.temperature = options.temperature ?? 0.1;
		this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
		this.adapter = options.adapter;
		this.dbPath = options.dbPath;
		this.logger = options.logger || console;
		// MCP components
		this.mcpServer = null;
		this.localClient = null;
		this.API = null;
		this.engine = null;
		this.isInitialized = false;
		this.onChunk = (_chunk) => {};
	}
	async init() {
		try {
			this.logger.info("[Kiwi Chatbot] DataDir: " + this.options.dbPath);
			this.API = new ioBrokerAdapterApi({
				adapter: this.adapter,
				namespace: this.adapter.namespace,
				provider: this.provider,
				apiKey: this.options.apiKey,
				dbPath: this.options.dbPath,
				logger: this.logger,
			});

			await this.API.init();

			this.mcpServer = new McpServer({
				name: "kiwi-chatbot",
				version: "1.0.0",
			});

			for (const toolName in Tools) {
				const tool = Tools[toolName];
				const toolHandler = tool.call(this.API);
				this.mcpServer.tool(tool.name, tool.desc, tool.params, toolHandler);
			}

			const serverTransport = new DirectTransport();
			await this.mcpServer.connect(serverTransport);

			const clientTransport = new DirectClientTransport(serverTransport);

			this.localClient = new Client({
				name: "kiwi-chatbot-client",
				version: "1.0.0",
			});

			await this.localClient.connect(clientTransport);

			const Engine = this.provider === "gemini" ? GeminiChat : OpenAiChat;
			this.engine = new Engine({
				apiKey: this.options.apiKey,
				model: this.modelName,
				temperature: this.temperature,
				systemPrompt: this.systemPrompt,
				mcpClient: this.localClient,
				logger: this.logger,
			});
			this.logger.info(`[Kiwi Chatbot] Using ${this.provider} model ${this.modelName}`);

			this.isInitialized = true;
		} catch (error) {
			this.logger.error(`Failed to initialize chatbot: ${error.message}`);
			throw error;
		}
	}

	async prompt(prompt) {
		try {
			if (!this.isInitialized || !this.engine) {
				throw new Error("Chatbot not initialized. Call init() first and wait for it to complete.");
			}
			return await this.engine.prompt(prompt);
		} catch (error) {
			this.logger.error(`Error in chat: ${error.message}`);
			throw error;
		}
	}

	async promptStream(prompt) {
		try {
			if (!this.isInitialized || !this.engine) {
				throw new Error("Chatbot not initialized. Call init() first and wait for it to complete.");
			}
			await this.engine.promptStream(prompt, this.onChunk);
		} catch (error) {
			this.logger.error(`Error in chat stream: ${error.message}`);
			throw error;
		}
	}

	// Get access to the local MCP client for advanced usage
	getClient() {
		return this.localClient;
	}

	// Get access to the ioBroker API for direct usage
	getAPI() {
		return this.API;
	}

	// Get list of available tools
	async getAvailableTools() {
		try {
			if (!this.localClient) {
				throw new Error("Client not initialized");
			}
			return await this.localClient.listTools();
		} catch (error) {
			this.logger?.error("Error getting tools:", error);
			return [];
		}
	}

	// Call a specific tool directly
	async callTool(toolName, parameters) {
		try {
			if (!this.localClient) {
				throw new Error("Client not initialized");
			}
			return await this.localClient.callTool({ name: toolName, arguments: parameters });
		} catch (error) {
			this.logger.error(`Error calling tool ${toolName}:`, error);
			throw error;
		}
	}

	// Cleanup method
	async cleanup() {
		try {
			if (this.localClient) {
				await this.localClient.close();
			}
			this.engine = null;
			this.logger.info("Chatbot cleanup completed");
		} catch (error) {
			this.logger.error("Error during cleanup:", error);
		}
	}

	// Reset chat history
	resetHistory() {
		this.engine?.reset();
	}

	// Get chat statistics
	getStats() {
		return {
			initialized: this.isInitialized,
			provider: this.provider,
			model: this.modelName,
			chatReady: !!this.engine,
			clientConnected: !!this.localClient,
			apiInitialized: !!this.API,
		};
	}
}
