// Helpers for the getHistory tool: time parsing, statistics and interval aggregation.
// Kept free of ioBroker calls so they can be unit tested.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNIT_MS = { s: SECOND, sec: SECOND, m: MINUTE, min: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };

/**
 * "Nice" interval sizes used when an interval has to be chosen automatically
 *
 * @type {Array<[string, number]>}
 */
const AUTO_INTERVALS = [
	["1m", MINUTE],
	["5m", 5 * MINUTE],
	["15m", 15 * MINUTE],
	["30m", 30 * MINUTE],
	["1h", HOUR],
	["3h", 3 * HOUR],
	["6h", 6 * HOUR],
	["12h", 12 * HOUR],
	["1d", DAY],
	["1w", 7 * DAY],
	["30d", 30 * DAY],
];

export const AGGREGATES = ["average", "min", "max", "sum", "count", "first", "last", "increase"];

/**
 * Parses a point in time as given by an AI client.
 * Accepts ms timestamps (or seconds, which models often send), "now", "today", "yesterday",
 * relative times like "-24h", "7d", "now-30m", "2w ago", "-1mo", "-1y", and dates like
 * "2026-10-01", "2026-10-01 08:00" (local time) or full ISO strings with offset.
 *
 * @param {string | number | undefined | null} input
 * @param {number} [now]
 * @returns {number | undefined} ms since epoch, undefined if input is empty
 */
export function parseTime(input, now = Date.now()) {
	if (input === undefined || input === null || input === "") {
		return undefined;
	}
	if (typeof input === "number") {
		return toMs(input, input);
	}
	const text = String(input).trim().toLowerCase();
	if (/^\d+(\.\d+)?$/.test(text)) {
		return toMs(Number(text), input);
	}
	if (text === "now") {
		return now;
	}
	if (text === "today" || text === "yesterday") {
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		if (text === "yesterday") {
			d.setDate(d.getDate() - 1);
		}
		return d.getTime();
	}
	const rel = text.match(/^(?:now\s*)?([+-])?\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|d|w|mo|y)(?:\s+ago)?$/);
	if (rel) {
		// without sign a relative time means "ago"
		const sign = rel[1] === "+" ? 1 : -1;
		const amount = Number(rel[2]);
		const unit = rel[3];
		if (unit === "mo" || unit === "y") {
			const d = new Date(now);
			d.setMonth(d.getMonth() + sign * Math.round(amount) * (unit === "y" ? 12 : 1));
			return d.getTime();
		}
		return now + sign * amount * UNIT_MS[unit];
	}
	const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnly) {
		// Date.parse would read a date-only string as UTC; users mean local midnight
		return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime();
	}
	// "2026-10-01 08:00" -> "2026-10-01T08:00", parsed as local time when no offset is given
	const ts = Date.parse(
		String(input)
			.trim()
			.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2"),
	);
	if (Number.isNaN(ts)) {
		throw new Error(
			`Invalid time "${input}". Use e.g. "-24h", "-7d", "today", "yesterday", "2026-10-01 08:00" or a timestamp in ms.`,
		);
	}
	return ts;
}

function toMs(value, original) {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid timestamp ${JSON.stringify(original)}.`);
	}
	// 1e11 ms is 1973, 1e11 s is far in the future: smaller values are seconds
	return value < 1e11 ? Math.round(value * 1000) : Math.round(value);
}

/**
 * @param {string} input e.g. "15m", "1h", "1d", "1w"
 * @returns {number} interval in ms
 */
export function parseInterval(input) {
	const m = String(input)
		.trim()
		.toLowerCase()
		.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|d|w)$/);
	if (!m || Number(m[1]) <= 0) {
		throw new Error(`Invalid interval "${input}". Use e.g. "15m", "1h", "1d" or "1w".`);
	}
	return Number(m[1]) * UNIT_MS[m[2]];
}

/**
 * Smallest "nice" interval that keeps the number of intervals within the limit.
 *
 * @param {number} rangeMs
 * @param {number} limit
 * @returns {{ label: string, ms: number }}
 */
export function autoInterval(rangeMs, limit) {
	for (const [label, ms] of AUTO_INTERVALS) {
		if (rangeMs / ms <= limit) {
			return { label, ms };
		}
	}
	const [label, ms] = AUTO_INTERVALS[AUTO_INTERVALS.length - 1];
	return { label, ms };
}

/**
 * Local time ISO string with offset, e.g. "2026-10-06T08:00:00+02:00".
 *
 * @param {number} ts
 */
export function toLocalIso(ts) {
	const d = new Date(ts);
	const offset = -d.getTimezoneOffset();
	const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
	const local = new Date(ts + offset * MINUTE).toISOString().slice(0, 19);
	return `${local}${offset >= 0 ? "+" : "-"}${pad(offset / 60)}:${pad(offset % 60)}`;
}

/**
 * Numeric value of a history entry: numbers, numeric strings, booleans (1/0). Otherwise null.
 *
 * @param {any} val
 * @returns {number | null}
 */
export function toNumber(val) {
	if (typeof val === "number") {
		return Number.isFinite(val) ? val : null;
	}
	if (typeof val === "boolean") {
		return val ? 1 : 0;
	}
	if (typeof val === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(val)) {
		return Number(val);
	}
	return null;
}

function round(value) {
	return value === null || value === undefined ? value : Math.round(value * 1000) / 1000;
}

/**
 * Statistics over all values in the range.
 *
 * @param {Array<{ ts: number, val: any }>} points sorted by ts
 * @param {number} end end of the range (for the duration of the last value)
 */
export function summarize(points, end) {
	const summary = { count: points.length };
	if (!points.length) {
		return summary;
	}
	const numeric = /** @type {Array<{ ts: number, val: number }>} */ (
		points.map((p) => ({ ts: p.ts, val: toNumber(p.val) })).filter((p) => p.val !== null)
	);
	const first = points[0];
	const last = points[points.length - 1];
	if (!numeric.length) {
		return {
			...summary,
			first: { ts: toLocalIso(first.ts), val: first.val },
			last: { ts: toLocalIso(last.ts), val: last.val },
		};
	}

	let min = numeric[0];
	let max = numeric[0];
	let sum = 0;
	let increase = 0;
	let weighted = 0;
	let duration = 0;
	numeric.forEach((p, i) => {
		if (p.val < min.val) {
			min = p;
		}
		if (p.val > max.val) {
			max = p;
		}
		sum += p.val;
		if (i > 0 && p.val > numeric[i - 1].val) {
			increase += p.val - numeric[i - 1].val;
		}
		// each value is valid until the next one (step function)
		const until = i + 1 < numeric.length ? numeric[i + 1].ts : Math.max(end, p.ts);
		weighted += p.val * (until - p.ts);
		duration += until - p.ts;
	});
	const nFirst = numeric[0];
	const nLast = numeric[numeric.length - 1];
	return {
		...summary,
		numericCount: numeric.length,
		min: { val: round(min.val), ts: toLocalIso(min.ts) },
		max: { val: round(max.val), ts: toLocalIso(max.ts) },
		average: round(sum / numeric.length),
		timeWeightedAverage: round(duration > 0 ? weighted / duration : sum / numeric.length),
		sum: round(sum),
		first: { val: round(nFirst.val), ts: toLocalIso(nFirst.ts) },
		last: { val: round(nLast.val), ts: toLocalIso(nLast.ts) },
		delta: round(nLast.val - nFirst.val),
		increase: round(increase),
	};
}

/**
 * Aggregates values into consecutive intervals. Day and week intervals follow local calendar days
 * (including daylight saving changes); shorter intervals are aligned to full local minutes/hours.
 *
 * @param {Array<{ ts: number, val: any }>} points sorted by ts
 * @param {number} start
 * @param {number} end
 * @param {number} intervalMs
 * @param {string} aggregate one of AGGREGATES
 * @returns {Array<[string, any]>} [interval start, value], empty intervals are left out
 */
export function aggregateIntervals(points, start, end, intervalMs, aggregate) {
	const days = intervalMs % DAY === 0 ? intervalMs / DAY : 0;
	let bucketStart;
	if (days) {
		const d = new Date(start);
		d.setHours(0, 0, 0, 0);
		bucketStart = d.getTime();
	} else {
		const offset = -new Date(start).getTimezoneOffset() * MINUTE;
		bucketStart = Math.floor((start + offset) / intervalMs) * intervalMs - offset;
	}
	const next = (t) => {
		if (!days) {
			return t + intervalMs;
		}
		const d = new Date(t);
		d.setDate(d.getDate() + days);
		return d.getTime();
	};

	/** @type {Array<[string, any]>} */
	const result = [];
	let i = 0;
	let previous = null; // last numeric value before the current interval, for "increase"
	while (bucketStart < end) {
		const bucketEnd = next(bucketStart);
		const values = [];
		const raw = [];
		while (i < points.length && points[i].ts < bucketEnd) {
			if (points[i].ts >= bucketStart) {
				raw.push(points[i].val);
				const n = toNumber(points[i].val);
				if (n !== null) {
					values.push(n);
				}
			}
			i++;
		}
		if (aggregate === "count") {
			result.push([toLocalIso(bucketStart), raw.length]);
		} else if (values.length) {
			result.push([toLocalIso(bucketStart), round(aggregateValues(values, aggregate, previous))]);
		} else if (raw.length && (aggregate === "first" || aggregate === "last")) {
			result.push([toLocalIso(bucketStart), aggregate === "first" ? raw[0] : raw[raw.length - 1]]);
		}
		if (values.length) {
			previous = values[values.length - 1];
		}
		bucketStart = bucketEnd;
	}
	return result;
}

function aggregateValues(values, aggregate, previous) {
	switch (aggregate) {
		case "min":
			return Math.min(...values);
		case "max":
			return Math.max(...values);
		case "sum":
			return values.reduce((a, b) => a + b, 0);
		case "first":
			return values[0];
		case "last":
			return values[values.length - 1];
		case "increase": {
			// growth of a meter/counter within the interval; drops (meter resets) are ignored
			let inc = 0;
			let prev = previous;
			for (const v of values) {
				if (prev !== null && v > prev) {
					inc += v - prev;
				}
				prev = v;
			}
			return inc;
		}
		case "average":
		default:
			return values.reduce((a, b) => a + b, 0) / values.length;
	}
}
