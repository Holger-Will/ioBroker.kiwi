// esm-mcp-bridge.js

let McpWebServerClass = null;

(async () => {
	try {
		const mcpModule = await import("./mcp-web.mjs");
		McpWebServerClass = mcpModule.MCP_Web_Server;
	} catch (e) {
		McpWebServerClass = class {
			constructor() {
				throw new Error("ESM MCP_Web_Server failed to load.");
			}
		};
	}
})();

function McpWebBridge(server, webSettings, adapter, instanceSettings, app) {
	this.app = app;
	this.config = instanceSettings ? instanceSettings.native : {};
	this.adapter = adapter;
	const that = this;
	this.readyCallback = null;
	this.waitForReady = (cb) => {
		this.readyCallback = cb;
		if (McpWebServerClass && that._mcpInstance) {
			cb(that);
		}
	};

	this._mcpInstance = null;

	(async () => {
		try {
			while (!McpWebServerClass) {
				await new Promise((resolve) => adapter.setTimeout(resolve, 50));
			}
			this._mcpInstance = new McpWebServerClass(server, webSettings, adapter, instanceSettings, app, that);

			if (this.readyCallback) {
				this.readyCallback(that);
			}
		} catch (e) {
			if (this.readyCallback) {
				this.readyCallback(e);
			}
		}
	}).call(this);

	this.unload = function () {
		if (that._mcpInstance && typeof that._mcpInstance.unload === "function") {
			return that._mcpInstance.unload();
		}
		return Promise.resolve();
	};

	this.welcomePage = () => {
		return {
			link: "kiwi/0/",
			name: "Kiwi",
			img: "path/to/kiwi-logo.png",
			color: "#FF5733",
			order: 5,
			pro: false,
		};
	};
}

module.exports = McpWebBridge;
