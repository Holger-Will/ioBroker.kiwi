import { z } from "zod";
const DESC = `Get historical values of an ioBroker state (sensor values, meter readings, switch states, ...) with ready-made statistics.

The history adapter (history, sql, influxdb) that logs the state is detected automatically.
Use listHistoryStates to find states that have history. Aliases (alias.0.*) can be used directly:
their target state's history is used.
If several states could match (e.g. several temperatures), pick the most plausible one for the question
(outdoor temperature for weather questions like "warmest day") and say which one you used, instead of asking back.

Times are given as text, no timestamp calculation needed:
- relative: "-24h", "-7d", "-30m", "-2w", "-1mo", "-1y" (ago from now)
- calendar: "today", "yesterday", "now"
- dates in local time: "2026-10-01", "2026-10-01 08:00"
Default range is the last 24 hours. The response contains the current server time ("now") and the resolved range.
If the user names a month or day without a year, use the most recent one that has already started (e.g. "September" asked in October 2026 = 2026-09-01 to 2026-10-01). Do not ask back, state the assumed year in the answer.
Long ranges (months, a whole year) are fine: all values are loaded and summarized.

The result always has a "summary" for the whole range:
count, min, max (with time), average, timeWeightedAverage (each value weighted by how long it was valid -
use this for temperatures or on/off states, booleans count as 1/0), sum, first, last,
delta (last - first) and increase (growth of a meter, ignores resets - use this for consumption like kWh or m³).

"series" lists the values over time: raw values if they fit into "limit", otherwise per interval.
Set "interval" ("15m", "1h", "1d", "1w") and "aggregate" for values per interval, e.g. consumption per day.

Examples:
- Electricity used yesterday: getHistory({ id: "smartmeter.0.total_kwh", start: "yesterday", end: "today" }) -> summary.increase
- Consumption per day this week: getHistory({ id: "smartmeter.0.total_kwh", start: "-7d", interval: "1d", aggregate: "increase" })
- Average temperature last week: getHistory({ id: "hm-rpc.0.ABC.1.TEMPERATURE", start: "-7d" }) -> summary.timeWeightedAverage
- Hottest hour today: getHistory({ id: "...", start: "today", interval: "1h", aggregate: "max" })
- Warmest day in September: getHistory({ id: "...", start: "2026-09-01", end: "2026-10-01", interval: "1d", aggregate: "max" }) -> day with the highest value (aggregate "average" for the warmest daily mean)
- Highest temperature this year: getHistory({ id: "...", start: "2026-01-01" }) -> summary.max (value and time)
- How long was the pump on yesterday: getHistory({ id: "...pump.on", start: "yesterday", end: "today" }) -> summary.timeWeightedAverage x 24 h
`;
export const getHistory = {
	name: "getHistory",
	desc: DESC,
	params: {
		id: z.string().describe("ID of the state, e.g. 'hue.0.livingroom.brightness'."),
		start: z
			.union([z.string(), z.number()])
			.optional()
			.describe(
				'Start of the range: "-24h", "-7d", "today", "yesterday", "2026-10-01 08:00" or ms timestamp. Default: -24h.',
			),
		end: z
			.union([z.string(), z.number()])
			.optional()
			.describe('End of the range, same formats as start. Default: "now".'),
		interval: z
			.string()
			.optional()
			.describe(
				'Interval for the series: "15m", "1h", "1d", "1w" or "auto". Without interval, raw values are listed if they fit into limit.',
			),
		aggregate: z
			.enum(["average", "min", "max", "sum", "count", "first", "last", "increase"])
			.optional()
			.describe(
				"Value per interval. 'increase' = growth of a meter/counter within the interval (consumption). Default: average.",
			),
		limit: z
			.number()
			.optional()
			.describe("Maximum number of series entries (1-500). Default: 100. The summary always covers all values."),
		instance: z
			.string()
			.optional()
			.describe("Only if a state is logged by several history instances: which one to use, e.g. 'sql.0'."),
	},
	call: (API) => async (args) => {
		const res = await API.getHistory(args);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(res),
				},
			],
			isError: !!(res && res.error),
		};
	},
};
