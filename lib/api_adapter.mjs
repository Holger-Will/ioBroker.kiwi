//import { iobrokerRoleDescriptions } from "./iobrokerRoles.js";
import { Query } from "mingo";
import { createVectorDB } from "./ai-provider.mjs";
import {
	AGGREGATES,
	aggregateIntervals,
	autoInterval,
	parseInterval,
	parseTime,
	summarize,
	toLocalIso,
} from "./history.mjs";
//const delay = ms => new Promise(resolve => setTimeout(resolve, ms)); // Add this line

// raw history values per request; a full answer means the window may be incomplete and is split
const HISTORY_PAGE_SIZE = 50000;
// upper bound of raw history values loaded for one getHistory call
const MAX_RAW_VALUES = 500000;

/**
 * Target state of an alias (alias.0.*): `common.alias.id` is a string or { read, write }.
 *
 * @param {any} obj
 * @returns {string | undefined}
 */
function aliasTargetOf(obj) {
	const alias = obj && obj.common && obj.common.alias;
	const target = alias && (typeof alias.id === "string" ? alias.id : alias.id && alias.id.read);
	return target || undefined;
}

function objectName(obj) {
	const name = obj && obj.common && obj.common.name;
	if (name && typeof name === "object") {
		return name.en || name.de || Object.values(name)[0] || "";
	}
	return name || "";
}

export class ioBrokerAdapterApi {
	constructor(options) {
		this.options = options;
		this.namespace = options.namespace || "kiwi.0";
		this.adapter = options.adapter;
		this.logger = options.logger || options.adapter.log || console;
		// vector store of the selected AI provider (instance setting `aiProvider`)
		this.vectorDB = createVectorDB({
			provider: options.provider,
			logger: this.logger,
			apiKey: options.apiKey,
			namespace: options.namespace,
			dbPath: options.dbPath,
		});
	}

	async init() {
		await this.vectorDB.init();
	}

	async search(text, filter = {}, limit = 10) {
		try {
			const items = (await this.vectorDB.find(text, limit)) || [];
			const results = await Promise.all(
				items.map(async (item) => {
					const state = await this.adapter.getForeignStateAsync(item.id);
					return { id: item.id, object: item.metadata, distance: item.distance, currentValue: state };
				}),
			);
			const q = new Query(filter);
			return q.find(results).all();
		} catch (error) {
			this.logger.error(`Search failed: ${error.message}`);
			return { status: "error", message: `Search failed: ${error.message}` };
		}
	}

	async mingoSearch(query, limit = 100, skip = 0) {
		try {
			// normalize: accept object, JSON-string, or wrapper {query|filter}
			let qObj = query;
			if (typeof qObj === "string") {
				try {
					qObj = JSON.parse(qObj);
				} catch (e) {
					this.logger.warn("mingoSearch: query is a non-JSON string -> using empty filter");
					qObj = {};
				}
			}
			if (qObj && typeof qObj === "object") {
				if (qObj.query) qObj = qObj.query;
				else if (qObj.filter) qObj = qObj.filter;
			}
			if (!qObj || typeof qObj !== "object") qObj = {};

			const types = [
				"state",
				"instance",
				"adapter",
				"device",
				"channel",
				"folder",
				"enum",
				"script",
				"config",
				"host",
				"user",
				"group",
			];

			this.logger.debug(`Starting mingoSearch with normalized query: ${JSON.stringify(qObj)}`);
			const objects = [];
			for (const type of types) {
				const objs = (await this.adapter.getForeignObjectsAsync("*", type)) || {};
				objects.push(...Object.values(objs));
			}

			const q = new Query(qObj);
			const cursor = q.find(objects);
			const res = cursor
				.skip(skip || 0)
				.limit(limit || 100)
				.all();
			this.logger.debug(`mingoSearch found ${Array.isArray(res) ? res.length : 0} results.`);
			return res;
		} catch (error) {
			this.logger.error(`mingoSearch failed: ${error?.message || error}`);
			return { status: "error", message: `mingoSearch failed: ${error?.message || error}` };
		}
	}

	async deleteItemFromIndex(id) {
		try {
			await this.vectorDB.deleteItem(id);
			return { status: "success", message: `Item with id ${id} deleted from index.` };
		} catch (error) {
			this.logger.error(`Failed to delete item with id ${id}: ${error.message}`);
			return { status: "error", message: `Failed to delete item with id ${id}: ${error.message}` };
		}
	}

	async getAllRooms() {
		return Object.values((await this.adapter.getEnumAsync("rooms")).result).map((room) => {
			return {
				name: !room.common.name.en ? room.common.name : room.common.name.en,
				id: room._id,
				members: room.common.members || [],
			};
		});
	}

	async getAdapters() {
		try {
			return await this.adapter.getForeignObjectsAsync("*", "adapter");
		} catch (error) {
			this.logger.error(`Error in getAdapters: ${error}`);
		}
	}

	async getRunningInstances() {
		try {
			return await this.mingoSearch({ type: "instance" });
		} catch (error) {
			this.logger.error(`Error in getAdapters: ${error}`);
		}
	}

	async getState(args) {
		try {
			const states = await this.adapter.getForeignStatesAsync(args.id);

			if (args.withInfo) {
				for (const key in states) {
					states[key].info = await this.adapter.getForeignObjectAsync(key);
				}
			}
			return states;
		} catch (error) {
			this.logger.error(`Error in getState: ${error}`);
			return { status: "error", error: `${error}` };
		}
	}
	async getStateBulk(args) {
		const ret = [];
		for (let i = 0; i < args.length; i++) {
			ret.push(await this.getState(args[i]));
		}
		return ret;
	}
	async setState(args) {
		try {
			const stateObjectResult = await this.getObject({ id: args.id });

			if (
				stateObjectResult.status !== "success" ||
				!stateObjectResult.object ||
				!stateObjectResult.object.common
			) {
				return {
					status: "error",
					error: `State ${args.id} not found or has no common properties`,
				};
			}

			const convertedValue = this.autoConvertType(args.value, stateObjectResult.object);

			await this.adapter.setForeignStateAsync(args.id, convertedValue, args.ack || false);

			const newState = await this.getState({ id: args.id });
			const currentState = newState[args.id];

			return {
				status: currentState.ack ? "success" : "sent",
				state: newState,
			};
		} catch (error) {
			this.logger.error(`Error in setState: ${error}`);
			return { status: "error", error: `${error}` };
		}
	}

	autoConvertType(value, stateObject) {
		const actualType = typeof value;
		const expectedType = stateObject.common.type;

		if (actualType !== expectedType) {
			switch (expectedType) {
				case "boolean":
					if (actualType === "string" && (value === "true" || value === "false")) {
						return value === "true";
					}
					break;
				case "number":
					if (actualType === "string" && !isNaN(Number(value))) {
						return Number(value);
					}
					break;
				case "string":
					return String(value);
			}
		}

		return value; // No conversion needed/possible
	}
	async setStateBulk(args) {
		const ret = [];
		for (let i = 0; i < args.length; i++) {
			ret.push(await this.setState(args[i]));
		}
		return ret;
	}
	async getStatesWithValues(_args) {
		return { status: "not implemented", message: `use getStateBulk with withInfo=true` };
		// return await this.fetch('/v1/states', 'GET', { filter: args.instancePattern || '*' });
	}
	async anotate(_args) {
		return { status: "not implemented", message: `use describe tool` };
		// let body = {"common":{"custom":{"kiwi.0":{"meta": args.anotation}}}}
		// return await this.fetch(`/v1/object/${args.id}`, 'PUT', {}, body);
	}
	async objExists(id) {
		try {
			if (!id) return false;

			if (this.adapter && typeof this.adapter.getForeignObjectAsync === "function") {
				const obj = await this.adapter.getForeignObjectAsync(id);

				// explicit null => not exists
				if (obj === null) return false;

				// some controllers may return empty objects; verify useful fields
				if (typeof obj === "object") {
					if (obj._id && String(obj._id) === String(id)) return true;
					if (obj.common && Object.keys(obj.common).length > 0) return true;
					// fallback: if object has any keys, assume it exists
					if (Object.keys(obj).length > 0) return true;
				}

				return false;
			}

			return false;
		} catch (error) {
			this.logger.debug(`objExists(${id}) error: ${error}`);
			return false;
		}
	}
	async describe(args) {
		try {
			const body = JSON.parse(
				`{"common":{"custom": {"${this.namespace}":{"enabled":true, "description": "${args.desc}"}}}}`,
			);
			//Prüfe ob das Objekt existiert
			if (!(await this.objExists(args.id))) {
				throw new Error(`Object with id ${args.id} does not exist`);
			}
			await this.adapter.extendForeignObjectAsync(args.id, body);
			const obj = await this.adapter.getForeignObjectAsync(args.id);
			return { status: "success", object: obj };
		} catch (error) {
			this.logger.error("Error in describe:", error);
			return { status: "error", error: `${error}` };
		}
		// if (!args.id || !args.desc) {
		// return await this.fetch(`/v1/object/${args.id}`, 'PUT', {}, body);
	}
	async describeBulk(args) {
		const ret = [];
		for (const arg of args) {
			ret.push(await this.describe(arg));
		}
		return ret;
	}

	async getObject(args) {
		try {
			const obj = await this.adapter.getForeignObjectAsync(args.id);
			return { status: "success", object: obj };
		} catch (error) {
			this.logger.error(`Error in getObject: ${error}`);
			return { status: "error", error: `${error}` };
		}
	}

	async setObject(args) {
		try {
			await this.adapter.extendForeignObjectAsync(args.id, args.obj);
			const obj = await this.adapter.getForeignObjectAsync(args.id);
			return { status: "success", object: obj };
		} catch (error) {
			this.logger.error(`Error in setObject: ${error}`);
			return { status: "error", error: `${error}` };
		}
	}

	async createState(_args) {
		return { status: "not implemented", message: `use setObject to create a states` };
	}
	async createScene(_args) {
		return { status: "not implemented", message: `not implemented` };
		// for scenes to work we need a custom script. check if it existst and if not create it
		// this.setObject({id:"script.js.mcp_scene_script",obj:{
		//     "type": "script",
		//     "common": {
		//     "name": "mcp_scene_script",
		//     "expert": true,
		//     "engineType": "Javascript/js",
		//     "enabled": true,
		//     "engine": "system.adapter.javascript.0",
		//     "source": "on(/^0_userdata.0.mcp_server.scene.*/,data=>{\r\n    if(data.state.val ==true){\r\n        setState(data.id,false,true)\r\n        let obj = getObject(data.id)\r\n        obj.native.members.forEach(m=>{\r\n            setState(m.id,m.value)\r\n        })\r\n    }\r\n})",
		//     "debug": false,
		//     "verbose": false
		//     },
		//     "native": {}
		// }})
		// const prefix = "0_userdata.0.mcp_server.scenes."
		// const ret = await this.createState({id:prefix + args.name, name: args.name, type: "boolean", role: "button.trigger",native:{members:args.members || []}});
		// this.setState({id:prefix + args.name, value: false}); // Initialize the scene state to false
		// return ret
	}
	/**
	 * sendTo with a timeout: an instance that is not installed or not running never answers.
	 *
	 * @param {string} instance
	 * @param {string} command
	 * @param {any} data
	 * @param {number} [timeoutMs]
	 */
	async sendToAsync(instance, command, data, timeoutMs = 20000) {
		return new Promise((resolve, reject) => {
			const timer = this.adapter.setTimeout(
				() => reject(new Error(`${instance} did not answer within ${timeoutMs / 1000} s`)),
				timeoutMs,
			);
			try {
				this.adapter.sendTo(instance, command, data, (result) => {
					this.adapter.clearTimeout(timer);
					if (!result) return reject(new Error(`No response from ${instance}`));
					if (result.error) return reject(new Error(String(result.error)));
					return resolve(result);
				});
			} catch (e) {
				this.adapter.clearTimeout(timer);
				reject(e);
			}
		});
	}

	/**
	 * Names of all instances that can answer getHistory (history, sql, influxdb, ...).
	 * History adapters declare `common.getHistory: true`.
	 *
	 * @returns {Promise<Set<string>>} e.g. "history.0"
	 */
	async _historyInstances() {
		const instances = (await this.adapter.getForeignObjectsAsync("system.adapter.*", "instance")) || {};
		return new Set(
			Object.values(instances)
				.filter((obj) => obj && obj.common && obj.common.getHistory)
				.map((obj) => obj._id.replace(/^system\.adapter\./, "")),
		);
	}

	/**
	 * History instances that are enabled in the custom settings of a state object.
	 *
	 * @param {any} obj
	 * @param {Set<string>} historyInstances
	 */
	_historySourcesOf(obj, historyInstances) {
		const custom = (obj && obj.common && obj.common.custom) || {};
		return Object.keys(custom).filter((inst) => historyInstances.has(inst) && custom[inst] && custom[inst].enabled);
	}

	/**
	 * Prefers the system default history instance, otherwise the first running one.
	 *
	 * @param {string[]} sources
	 */
	async _pickHistorySource(sources) {
		const systemConfig = await this.adapter.getForeignObjectAsync("system.config");
		const preferred = systemConfig && systemConfig.common && systemConfig.common.defaultHistory;
		const ordered = sources.includes(preferred) ? [preferred, ...sources.filter((s) => s !== preferred)] : sources;
		for (const inst of ordered) {
			const alive = await this.adapter.getForeignStateAsync(`system.adapter.${inst}.alive`);
			if (alive && alive.val) {
				return inst;
			}
		}
		return undefined;
	}

	/**
	 * Loads all raw values of a range in time windows. History adapters cap a request at `count` values
	 * and do not agree on which values they drop, so a window that comes back full is split and loaded again.
	 *
	 * @param {string} source history instance
	 * @param {string} id
	 * @param {number} start
	 * @param {number} end
	 * @returns {Promise<{ points: Array<{ ts: number, val: any }>, truncated: boolean, requests: number }>}
	 */
	async _loadRawHistory(source, id, start, end) {
		const MIN_WINDOW = 60 * 1000;
		let window = Math.min(end - start, 31 * 24 * 60 * 60 * 1000) || MIN_WINDOW;
		let from = start;
		let requests = 0;
		const points = [];
		while (from <= end) {
			const to = Math.min(from + window, end);
			const response = await this.sendToAsync(source, "getHistory", {
				id,
				options: {
					start: from,
					end: to,
					aggregate: "none",
					count: HISTORY_PAGE_SIZE,
					limit: HISTORY_PAGE_SIZE,
					ignoreNull: true,
					removeBorderValues: true,
					returnNewestEntries: false,
					ack: false,
					from: false,
					q: false,
				},
			});
			requests++;
			const raw = Array.isArray(response) ? response : response.result || [];
			if (raw.length >= HISTORY_PAGE_SIZE && window > MIN_WINDOW) {
				// possibly incomplete: retry with a smaller window
				window = Math.max(Math.floor(window / 4), MIN_WINDOW);
				continue;
			}
			for (const e of raw) {
				if (e && typeof e.ts === "number" && e.ts >= from && e.ts <= to) {
					points.push({ ts: e.ts, val: e.val });
				}
			}
			if (points.length >= MAX_RAW_VALUES) {
				points.sort((a, b) => a.ts - b.ts);
				return { points: points.slice(0, MAX_RAW_VALUES), truncated: true, requests };
			}
			if (raw.length < HISTORY_PAGE_SIZE / 4) {
				window *= 2;
			}
			from = to + 1;
		}
		points.sort((a, b) => a.ts - b.ts);
		return { points, truncated: false, requests };
	}

	async getHistory(args) {
		const id = args && args.id;
		try {
			if (!id) {
				return { error: "Parameter id is missing." };
			}
			const obj = await this.adapter.getForeignObjectAsync(id);
			if (!obj) {
				return { id, error: `State ${id} does not exist.` };
			}

			// which history adapters log this state?
			const historyInstances = await this._historyInstances();
			if (!historyInstances.size) {
				return { id, error: "No history adapter (history, sql, influxdb) is installed." };
			}
			let sources = this._historySourcesOf(obj, historyInstances);
			// aliases usually have no history of their own: their target state is logged
			let historyId = id;
			const aliasTarget = sources.length ? undefined : aliasTargetOf(obj);
			if (aliasTarget) {
				const targetObj = await this.adapter.getForeignObjectAsync(aliasTarget);
				const targetSources = this._historySourcesOf(targetObj, historyInstances);
				if (targetSources.length) {
					historyId = aliasTarget;
					sources = targetSources;
				}
			}
			if (!sources.length) {
				return {
					id,
					error: `History is not enabled for ${id}${aliasTarget ? ` (alias of ${aliasTarget})` : ""}.`,
					hint: `Enable logging for this state in one of the history instances (${[...historyInstances].join(", ")}) or use listHistoryStates to find states that have history.`,
				};
			}
			let source;
			if (args.instance) {
				if (!sources.includes(args.instance)) {
					return { id, error: `${args.instance} does not log ${historyId}.`, availableSources: sources };
				}
				source = args.instance;
			} else {
				source = await this._pickHistorySource(sources);
				if (!source) {
					return { id, error: `No running history instance for ${id}.`, availableSources: sources };
				}
			}

			// time range
			const now = Date.now();
			let start = parseTime(args.start, now) ?? now - 24 * 60 * 60 * 1000;
			let end = parseTime(args.end, now) ?? now;
			if (start > end) {
				[start, end] = [end, start];
			}
			const limit = Math.min(Math.max(parseInt(args.limit, 10) || 100, 1), 500);
			const aggregate = args.aggregate || "average";
			if (!AGGREGATES.includes(aggregate)) {
				return { id, error: `Unknown aggregate "${aggregate}". Use one of: ${AGGREGATES.join(", ")}.` };
			}
			const interval = args.interval && args.interval !== "auto" ? parseInterval(args.interval) : null;

			// raw values; statistics and intervals are computed here, the same way for every history adapter
			const loaded = await this._loadRawHistory(source, historyId, start, end);
			const points = loaded.points;

			const notes = [];
			if (loaded.truncated && points.length) {
				notes.push(
					`More than ${MAX_RAW_VALUES} values in the range: statistics only cover up to ${toLocalIso(points[points.length - 1].ts)}. Use a shorter range.`,
				);
			}
			if (!points.length) {
				notes.push(`${source} has no values for ${historyId} in this range.`);
			}
			if (historyId !== id && obj.common.alias.read) {
				notes.push(`Values are those of ${historyId}; the read conversion of the alias is not applied.`);
			}

			// series: requested interval; otherwise raw values if they fit, else an automatic interval
			let series;
			if (interval || args.interval === "auto" || points.length > limit) {
				const step = interval ? { label: args.interval, ms: interval } : autoInterval(end - start, limit);
				let values = aggregateIntervals(points, start, end, step.ms, aggregate);
				if (!interval && points.length > limit) {
					notes.push(`${points.length} raw values aggregated to ${step.label} ${aggregate}.`);
				}
				if (values.length > limit) {
					notes.push(
						`Only the last ${limit} of ${values.length} intervals are listed. Use a larger interval.`,
					);
					values = values.slice(-limit);
				}
				series = { interval: step.label, aggregate, values };
			} else {
				series = { interval: "raw", values: points.map((p) => [toLocalIso(p.ts), p.val]) };
			}

			return {
				id,
				name: objectName(obj),
				unit: obj.common.unit || undefined,
				historyOf: historyId !== id ? historyId : undefined,
				source,
				availableSources: sources.length > 1 ? sources : undefined,
				now: toLocalIso(now),
				range: { start: toLocalIso(start), end: toLocalIso(end) },
				summary: summarize(points, Math.min(end, now)),
				series,
				notes: notes.length ? notes : undefined,
			};
		} catch (error) {
			this.logger.error(`Error in getHistory for ${id}: ${error.message || error}`);
			return { id, error: error.message || String(error) };
		}
	}

	/**
	 * States that have history enabled, optionally filtered by id pattern and text.
	 *
	 * @param {{ pattern?: string, search?: string, limit?: number }} args
	 */
	async listHistoryStates(args = {}) {
		try {
			const historyInstances = await this._historyInstances();
			if (!historyInstances.size) {
				return { error: "No history adapter (history, sql, influxdb) is installed." };
			}
			const objects = (await this.adapter.getForeignObjectsAsync(args.pattern || "*", "state")) || {};
			const search = args.search ? String(args.search).toLowerCase() : null;
			const limit = Math.min(Math.max(parseInt(String(args.limit), 10) || 200, 1), 1000);
			const states = [];
			for (const obj of Object.values(objects)) {
				let sources = this._historySourcesOf(obj, historyInstances);
				let historyOf;
				const aliasTarget = sources.length ? undefined : aliasTargetOf(obj);
				if (aliasTarget) {
					const targetObj = objects[aliasTarget] || (await this.adapter.getForeignObjectAsync(aliasTarget));
					sources = this._historySourcesOf(targetObj, historyInstances);
					historyOf = aliasTarget;
				}
				if (!sources.length) {
					continue;
				}
				const name = objectName(obj);
				if (search && !`${obj._id} ${name}`.toLowerCase().includes(search)) {
					continue;
				}
				states.push({ id: obj._id, name, unit: obj.common.unit || undefined, sources, historyOf });
			}
			states.sort((a, b) => a.id.localeCompare(b.id));
			return {
				historyInstances: [...historyInstances],
				total: states.length,
				states: states.slice(0, limit),
				notes:
					states.length > limit
						? [`Only the first ${limit} of ${states.length} states are listed.`]
						: undefined,
			};
		} catch (error) {
			this.logger.error(`Error in listHistoryStates: ${error.message || error}`);
			return { error: error.message || String(error) };
		}
	}

	async deleteObject(args) {
		try {
			await this.adapter.delForeignObjectAsync(args.id);
			return { status: "success", message: `Object with id ${args.id} deleted.` };
		} catch (error) {
			this.logger.error(`Failed to delete object with id ${args.id}: ${error.message}`);
			return { status: "error", message: `Failed to delete object with id ${args.id}: ${error.message}` };
		}
	}
	async readDir(args) {
		try {
			const files = await this.adapter.readDirAsync(this.namespace, args.path);
			return { status: "success", files: files };
		} catch (error) {
			this.logger.error(`Failed to read directory ${args.path}: ${error.message}`);
			return { status: "error", message: `Failed to read directory ${args.dir}: ${error.message}` };
		}
	}
	async readFile(args) {
		try {
			const fileContent = await this.adapter.readFileAsync(this.namespace, args.path);
			return { status: "success", content: fileContent };
		} catch (error) {
			this.logger.error(`Failed to read file ${args.path}: ${error.message}`);
			return { status: "error", message: `Failed to read file ${args.path}: ${error.message}` };
		}
		// return {status:"not implemented", message:`use readDir and readFile`};
	}
	async writeFile(args) {
		try {
			await this.adapter.writeFileAsync(this.namespace, args.path, args.content);
			return { status: "success", message: `File ${args.path} written successfully.` };
		} catch (error) {
			this.logger.error(`Failed to write file ${args.path}: ${error.message}`);
			return { status: "error", message: `Failed to write file ${args.path}: ${error.message}` };
		}
	}
	async fileExists(args) {
		try {
			const exists = await this.adapter.fileExistsAsync(this.namespace, args.path);
			return { status: "success", exists: exists };
		} catch (error) {
			this.logger.error(`Failed to check if file ${args.path} exists: ${error.message}`);
			return { status: "error", message: `Failed to check if file ${args.path} exists: ${error.message}` };
		}
	}
	async mkdir(args) {
		try {
			await this.adapter.mkdirAsync(this.namespace, args.path);
			return { status: "success", message: `Directory '${args.path}' created.` };
		} catch (error) {
			this.logger.error(`Failed to create directory ${args.path}: ${error.message}`);
			return { status: "error", message: `Failed to create directory ${args.path}: ${error.message}` };
		}
	}
	async renameFile(args) {
		try {
			await this.adapter.renameAsync(this.namespace, args.oldPath, args.newPath);
			return { status: "success", message: `File renamed from '${args.oldPath}' to '${args.newPath}'.` };
		} catch (error) {
			this.logger.error(`Failed to rename file from ${args.oldPath} to ${args.newPath}: ${error.message}`);
			return {
				status: "error",
				message: `Failed to rename file from ${args.oldPath} to ${args.newPath}: ${error.message}`,
			};
		}
	}
	async deleteFile(args) {
		try {
			await this.adapter.delFileAsync(this.namespace, args.path);
			return { status: "success", message: `File '${args.path}' deleted.` };
		} catch (error) {
			this.logger.error(`Failed to delete file ${args.path}: ${error.message}`);
			return { status: "error", message: `Failed to delete object with id ${args.id}: ${error.message}` };
		}
	}
}
