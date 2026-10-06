/* eslint-disable */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { Tools } from "./tools/allTools.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ioBrokerAdapterApi } from "./api_adapter.mjs";
import * as utils from "@iobroker/adapter-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)).toString());
/* function log(msg){
appendFileSync( '/home/holger/errorlog', msg + '\n')
} */

const server = new McpServer({
	name: "kiwi",
	version: pkg.version,
});
/**
 * This code runs in the web adapter process, which reads the kiwi instance object directly.
 * encryptedNative values are therefore still encrypted and have to be decrypted with the system secret.
 */
function decryptIfNeeded(adapter, value) {
	if (typeof value === "string" && value.startsWith("$/aes-192-cbc:") && typeof adapter.decrypt === "function") {
		return adapter.decrypt(value);
	}
	return value;
}

class MCP_Web_Server {
	constructor(server, webSettings, adapter, instanceSettings, app, ref) {
		this.server = server;
		this.webSettings = webSettings;
		this.adapter = adapter;
		this.logger = adapter.log || console;
		this.instanceSettings = instanceSettings;
		this.app = app;
		this.readyCallback = null;
		this.ref = ref;
		this.init();
	}
	async handleRequest(req, res) {
		try {
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
			});
			res.on("close", () => {
				this.logger.info("Request closed");
				transport.close();
				server.close();
			});
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
		} catch (error) {
			this.logger.error("Error handling MCP request:", error);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: "2.0",
					error: {
						code: -32603,
						message: "Internal server error",
					},
					id: null,
				});
			}
		}
	}
	async methodNotAllowed(req, res) {
		this.logger.info("Method not allowed:", req.method);
		res.writeHead(405).end(
			JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Method not allowed: " + req.method,
				},
				id: null,
			}),
		);
	}
	init() {
		//this.adapter.subscribeForeignObjects("*");
		const splitedId = this.instanceSettings._id.split(".");
		const base = `/${splitedId[2]}/${splitedId[3]}/`;
		this.logger.info(`[Kiwi Web] MCP Web Server started at ${base}`);

		this.API = new ioBrokerAdapterApi({
			adapter: this.adapter,
			namespace: this.ref.config.namespace,
			provider: this.ref.config.aiProvider,
			apiKey: decryptIfNeeded(this.adapter, this.ref.config.apiKey),
			dbPath: this.ref.config.dataDir,
			logger: this.logger,
		});

		this.API.init();

		this.logger.info(`[Kiwi Web] API initialized with namespace: ${this.API.namespace}`);
		this.Tools = Tools;
		for (const toolName in this.Tools) {
			const tool = this.Tools[toolName];
			server.tool(tool.name, tool.desc, tool.params, tool.call(this.API));
		}
		this.logger.info(`[Kiwi Web] Tools registered: ${Object.keys(this.Tools).join(", ")}`);
		//const router = express.Router();
		this.app.use(base, express.static(path.join(__dirname, "public")));
		this.logger.info(`[Kiwi Web] Static files served from: ${path.join(__dirname, "public")}`);
		this.app.use(
			base + "user_data",
			express.static(utils.getAbsoluteDefaultDataDir() + "files/" + splitedId[2] + "." + splitedId[3]),
		);
		this.logger.info(
			`[Kiwi Web] Static files served from: ${utils.getAbsoluteDefaultDataDir() + "files/" + splitedId[2] + "." + splitedId[3]}`,
		);
		// const noCache = (req, res, next) => {
		// 	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
		// 	res.setHeader("Pragma", "no-cache");
		// 	res.setHeader("Expires", "0");
		// 	next();
		// };
		// this.logger.info(`[Kiwi Web] No-cache middleware set up`);
		const that = this;
		const mw = (req, res, next) => {
			that.logger.info(`[Kiwi Web] Request received: ${req.method} ${JSON.stringify(req.headers)}`);
			that.logger.info(`[Kiwi Web] sending response with header:  ${JSON.stringify(req.headers)}`);
			next();
		};

		try {
			//router.use(noCache);
			//this.app.use(mw);
			this.app.set("etag", false);
			this.app.post(base + "mcp", this.handleRequest.bind(this));
			this.app.post(base + "message", this.handleRequest.bind(this));
			this.app.post(base + "tool", this.handleRequest.bind(this));
			this.app.post(base + "sse", this.handleRequest.bind(this));
			this.app.get(base + "mcp", this.methodNotAllowed.bind(this));
			this.app.delete(base + "mcp", this.methodNotAllowed.bind(this));
			this.app.get(base + "test", (req, res) => {
				res.send("Kiwi Web Server is running!");
			});
			this.logger.info(`[Kiwi Web] Router attached`);
		} catch (error) {
			this.logger.error(`[Kiwi Web] Error attaching router: ${error.message}`);
		}
	}
}

export { MCP_Web_Server };
