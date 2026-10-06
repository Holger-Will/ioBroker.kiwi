"use strict";

const { expect } = require("chai");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

describe("history helpers", function () {
	this.timeout(30000);

	let h;
	before(async () => {
		h = await import("./history.mjs");
	});

	describe("parseTime", () => {
		const now = new Date(2026, 9, 6, 12, 30, 0).getTime(); // local time

		it("understands relative times", () => {
			expect(h.parseTime("-24h", now)).to.equal(now - DAY);
			expect(h.parseTime("24h", now)).to.equal(now - DAY);
			expect(h.parseTime("now-30m", now)).to.equal(now - 30 * 60 * 1000);
			expect(h.parseTime("2w ago", now)).to.equal(now - 14 * DAY);
			expect(h.parseTime("now", now)).to.equal(now);
			expect(new Date(h.parseTime("-1mo", now)).getMonth()).to.equal(8);
		});

		it("understands calendar words and local dates", () => {
			expect(h.parseTime("today", now)).to.equal(new Date(2026, 9, 6).getTime());
			expect(h.parseTime("yesterday", now)).to.equal(new Date(2026, 9, 5).getTime());
			expect(h.parseTime("2026-10-01", now)).to.equal(new Date(2026, 9, 1).getTime());
			expect(h.parseTime("2026-10-01 08:00", now)).to.equal(new Date(2026, 9, 1, 8, 0).getTime());
			expect(h.parseTime("2026-10-01T08:00:00Z", now)).to.equal(Date.UTC(2026, 9, 1, 8));
		});

		it("accepts ms and seconds timestamps", () => {
			expect(h.parseTime(1759740000000, now)).to.equal(1759740000000);
			expect(h.parseTime(1759740000, now)).to.equal(1759740000000);
			expect(h.parseTime("1759740000000", now)).to.equal(1759740000000);
			expect(h.parseTime(undefined, now)).to.equal(undefined);
		});

		it("explains invalid input", () => {
			expect(() => h.parseTime("last tuesday", now)).to.throw(/Invalid time "last tuesday".*-24h/);
			expect(() => h.parseInterval("hourly")).to.throw(/Invalid interval/);
		});
	});

	it("formats local ISO times with offset", () => {
		const ts = new Date(2026, 9, 6, 8, 0, 0).getTime();
		expect(h.toLocalIso(ts)).to.match(/^2026-10-06T08:00:00[+-]\d\d:\d\d$/);
	});

	describe("summarize", () => {
		const t0 = new Date(2026, 9, 1, 0, 0).getTime();

		it("computes statistics for a meter with a reset", () => {
			const points = [
				{ ts: t0, val: 100 },
				{ ts: t0 + HOUR, val: 105 },
				{ ts: t0 + 2 * HOUR, val: "110" }, // numeric strings count
				{ ts: t0 + 3 * HOUR, val: 0 }, // meter reset
				{ ts: t0 + 4 * HOUR, val: 3 },
			];
			const s = h.summarize(points, t0 + 5 * HOUR);
			expect(s.count).to.equal(5);
			expect(s.min.val).to.equal(0);
			expect(s.max.val).to.equal(110);
			expect(s.first.val).to.equal(100);
			expect(s.last.val).to.equal(3);
			expect(s.delta).to.equal(-97);
			expect(s.increase).to.equal(13); // 5 + 5 + 3, the reset is ignored
		});

		it("weights values by duration (on/off share)", () => {
			const points = [
				{ ts: t0, val: false },
				{ ts: t0 + 18 * HOUR, val: true }, // on for the last 6 hours
			];
			const s = h.summarize(points, t0 + DAY);
			expect(s.average).to.equal(0.5);
			expect(s.timeWeightedAverage).to.equal(0.25);
		});

		it("handles empty and non-numeric data", () => {
			expect(h.summarize([], t0)).to.deep.equal({ count: 0 });
			const s = h.summarize([{ ts: t0, val: "open" }], t0 + HOUR);
			expect(s.first.val).to.equal("open");
			expect(s).to.not.have.property("average");
		});
	});

	describe("aggregateIntervals", () => {
		const day1 = new Date(2026, 9, 1).getTime();

		it("computes consumption per local day", () => {
			const points = [];
			for (let i = 0; i <= 3 * 24; i++) {
				points.push({ ts: day1 + i * HOUR, val: 1000 + i }); // +1 kWh per hour
			}
			const values = h.aggregateIntervals(points, day1, day1 + 3 * DAY, DAY, "increase");
			expect(values).to.have.length(3);
			expect(values[0][0]).to.match(/^2026-10-01T00:00:00/);
			// first day: 23 steps inside the day, later days also count the step from the previous day
			expect(values.map((v) => v[1])).to.deep.equal([23, 24, 24]);
		});

		it("aggregates per hour and leaves out empty intervals", () => {
			const points = [
				{ ts: day1 + 10 * 60 * 1000, val: 20 },
				{ ts: day1 + 20 * 60 * 1000, val: 22 },
				{ ts: day1 + 2 * HOUR + 5 * 60 * 1000, val: 30 },
			];
			const values = h.aggregateIntervals(points, day1, day1 + 3 * HOUR, HOUR, "average");
			expect(values.map((v) => v[1])).to.deep.equal([21, 30]);
			const counts = h.aggregateIntervals(points, day1, day1 + 3 * HOUR, HOUR, "count");
			expect(counts.map((v) => v[1])).to.deep.equal([2, 0, 1]);
		});

		it("chooses a nice automatic interval", () => {
			expect(h.autoInterval(DAY, 100).label).to.equal("15m");
			expect(h.autoInterval(7 * DAY, 100).label).to.equal("3h");
			expect(h.autoInterval(365 * DAY, 100).label).to.equal("1w");
		});
	});
});

describe("getHistory / listHistoryStates (fake ioBroker)", function () {
	this.timeout(30000);

	let API;
	let sent;
	before(async () => {
		const { ioBrokerAdapterApi } = await import("./api_adapter.mjs");
		const now = Date.now();
		const objects = {
			"system.adapter.history.0": { _id: "system.adapter.history.0", common: { getHistory: true } },
			"system.adapter.sql.0": { _id: "system.adapter.sql.0", common: { getHistory: true } },
			"system.adapter.hue.0": { _id: "system.adapter.hue.0", common: {} },
			"system.config": { _id: "system.config", common: { defaultHistory: "sql.0" } },
			"meter.0.kwh": {
				_id: "meter.0.kwh",
				type: "state",
				common: {
					name: { en: "Energy meter", de: "Stromzähler" },
					unit: "kWh",
					custom: { "sql.0": { enabled: true }, "history.0": { enabled: true } },
				},
			},
			"hue.0.lamp.on": { _id: "hue.0.lamp.on", type: "state", common: { name: "Lamp", custom: {} } },
			"alias.0.Strom.Zaehler": {
				_id: "alias.0.Strom.Zaehler",
				type: "state",
				common: { name: "Stromzähler", unit: "kWh", alias: { id: "meter.0.kwh" }, custom: {} },
			},
			"temp.0.living": {
				_id: "temp.0.living",
				type: "state",
				common: { name: "Living room temperature", unit: "°C", custom: { "history.0": { enabled: true } } },
			},
		};
		const states = {
			"system.adapter.history.0.alive": { val: true },
			"system.adapter.sql.0.alive": { val: false }, // default instance is stopped
		};
		const history = {
			"meter.0.kwh": [
				{ ts: now - 3 * HOUR, val: 10 },
				{ ts: now - 2 * HOUR, val: 12 },
				{ ts: now - HOUR, val: 15 },
			],
		};
		sent = [];
		const adapter = {
			namespace: "kiwi.0",
			log: { debug() {}, info() {}, warn() {}, error() {} },
			setTimeout: (cb, ms) => setTimeout(cb, ms),
			clearTimeout: (t) => clearTimeout(t),
			getForeignObjectAsync: async (id) => objects[id] || null,
			getForeignObjectsAsync: async (pattern, type) => {
				const re = new RegExp(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
				return Object.fromEntries(
					Object.entries(objects).filter(
						([id, o]) =>
							re.test(id) &&
							(!type || o.type === type || (type === "instance" && id.startsWith("system.adapter."))),
					),
				);
			},
			getForeignStateAsync: async (id) => states[id] || null,
			sendTo: (instance, command, msg, cb) => {
				sent.push({ instance, command, msg });
				if (instance === "history.0" && command === "getHistory") {
					cb({ result: history[msg.id] || [] });
				}
				// other instances never answer
			},
		};
		API = new ioBrokerAdapterApi({ adapter, namespace: "kiwi.0", dbPath: require("node:os").tmpdir() });
	});

	it("detects the history source from the state and skips stopped instances", async () => {
		const res = await API.getHistory({ id: "meter.0.kwh", start: "-6h" });
		expect(res.error).to.equal(undefined);
		expect(res.source).to.equal("history.0"); // sql.0 is the default but not running
		expect(res.availableSources).to.have.members(["sql.0", "history.0"]);
		expect(res.name).to.equal("Energy meter");
		expect(res.unit).to.equal("kWh");
		expect(res.summary).to.include({ count: 3, delta: 5, increase: 5 });
		expect(res.series.interval).to.equal("raw");
		expect(res.series.values).to.have.length(3);
		expect(res.now).to.be.a("string");

		const query = sent.find((s) => s.command === "getHistory").msg.options;
		expect(query.aggregate).to.equal("none");
		expect(query.end - query.start).to.be.closeTo(6 * HOUR, 1000);
	});

	it("uses the history of the alias target", async () => {
		const res = await API.getHistory({ id: "alias.0.Strom.Zaehler", start: "-6h" });
		expect(res.error).to.equal(undefined);
		expect(res).to.include({ id: "alias.0.Strom.Zaehler", historyOf: "meter.0.kwh", name: "Stromzähler" });
		expect(res.summary).to.include({ count: 3, increase: 5 });
	});

	it("aggregates per interval on request", async () => {
		const res = await API.getHistory({ id: "meter.0.kwh", start: "-6h", interval: "1h", aggregate: "increase" });
		expect(res.series).to.include({ interval: "1h", aggregate: "increase" });
		expect(res.series.values.map((v) => v[1]).reduce((a, b) => a + b, 0)).to.equal(5);
	});

	it("explains what is wrong instead of returning nothing", async () => {
		const notEnabled = await API.getHistory({ id: "hue.0.lamp.on" });
		expect(notEnabled.error).to.match(/History is not enabled/);
		expect(notEnabled.hint).to.match(/history\.0, sql\.0|sql\.0, history\.0/);

		const missing = await API.getHistory({ id: "does.not.exist" });
		expect(missing.error).to.match(/does not exist/);

		const wrongInstance = await API.getHistory({ id: "temp.0.living", instance: "sql.0" });
		expect(wrongInstance.error).to.match(/sql\.0 does not log temp\.0\.living/);

		const badTime = await API.getHistory({ id: "meter.0.kwh", start: "last tuesday" });
		expect(badTime.error).to.match(/Invalid time/);
	});

	it("loads long ranges completely in time windows, even if the adapter drops values of full answers", async () => {
		const { ioBrokerAdapterApi } = await import("./api_adapter.mjs");
		const start = new Date(2026, 0, 1).getTime();
		const values = [];
		for (let i = 0; i < 35040; i++) {
			values.push({ ts: start + i * 15 * 60 * 1000, val: i === 20000 ? 99 : 10 }); // one year, max in August
		}
		let requests = 0;
		const adapter = {
			log: { debug() {}, info() {}, warn() {}, error() {} },
			setTimeout: (cb, ms) => setTimeout(cb, ms),
			clearTimeout: (t) => clearTimeout(t),
			sendTo: (instance, command, msg, cb) => {
				requests++;
				const o = msg.options;
				const inRange = values.filter((e) => e.ts >= o.start && e.ts <= o.end);
				// worst case: like ioBroker.history, keep only the newest `count` values of a full answer
				cb({ result: inRange.slice(-o.count) });
			},
		};
		const api = new ioBrokerAdapterApi({ adapter, namespace: "kiwi.0", dbPath: require("node:os").tmpdir() });
		const end = values[values.length - 1].ts;
		const loaded = await api._loadRawHistory("history.0", "x", start, end);
		expect(loaded.truncated).to.equal(false);
		expect(loaded.points).to.have.length(values.length);
		expect(Math.max(...loaded.points.map((p) => p.val))).to.equal(99);
		expect(requests).to.be.below(40);
	});

	it("times out instead of hanging when an instance does not answer", async () => {
		await expect(API.sendToAsync("sql.0", "getHistory", {}, 50)).to.be.rejectedWith(/did not answer/);
	});

	it("lists states with history", async () => {
		const all = await API.listHistoryStates({});
		expect(all.historyInstances).to.have.members(["history.0", "sql.0"]);
		expect(all.states.map((s) => s.id)).to.deep.equal(["alias.0.Strom.Zaehler", "meter.0.kwh", "temp.0.living"]);
		expect(all.states[0].historyOf).to.equal("meter.0.kwh");

		const temps = await API.listHistoryStates({ search: "temperature" });
		expect(temps.states).to.have.length(1);
		expect(temps.states[0]).to.include({ id: "temp.0.living", unit: "°C" });
	});
});
