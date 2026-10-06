import { z } from "zod";
const DESC = `List the ioBroker states that have history logging enabled (history, sql or influxdb adapter),
with name, unit and the history instances that log them. Use this before getHistory when you do not know the exact state ID.

Examples:
- all states with history: listHistoryStates({})
- temperatures: listHistoryStates({ search: "temperatur" })
- one adapter: listHistoryStates({ pattern: "hm-rpc.0.*" })
`;
export const listHistoryStates = {
	name: "listHistoryStates",
	desc: DESC,
	params: {
		pattern: z.string().optional().describe("ID pattern with * wildcards, e.g. 'shelly.0.*'. Default: all states."),
		search: z.string().optional().describe("Text that must appear in the ID or name (case-insensitive)."),
		limit: z.number().optional().describe("Maximum number of states (1-1000). Default: 200."),
	},
	call: (API) => async (args) => {
		const res = await API.listHistoryStates(args);
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
