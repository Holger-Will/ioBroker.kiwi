import { z } from "zod";
const DESC = `get the value of states in bulks in the ioBroker system.
    You can specify the state by its ID, which is usually in the format {instance}.{adapter}.{state} (e.g., 'hue.0.deviceId.brightness') allows for wildcards 'hue.0.deviceId.*' or 'hue.0.*.brightness'."
    when you provide the withInfo parameter, the result will include additional information about the state, such as its type, common properties, and enums.
    if you are interested in just the states info and not its value, you can use getObject
    `;
export const getStateBulk = {
	name: "getIobrokerStateBulk",
	desc: DESC,
	params: {
		states: z
			.array(
				z.object({
					id: z
						.string()
						.describe(
							"The ID of the states to get. This is usually in the format {instance}.{adapter}.{state} (e.g., 'hue.0.deviceId.brightness') allows for wildcards 'hue.0.deviceId.*' or 'hue.0.*.brightness'.",
						),
					withInfo: z
						.boolean()
						.optional()
						.default(false)
						.describe(
							"If true, the result will include additional information about the state, such as its type, common properties, roles and enums. if you are only interrested in this metadata, use getObject",
						),
				}),
			)
			.describe("An array of states to set. Each state is an object with an 'id' and a 'value'."),
	},
	call: (API) => async (args) => {
		const ret = await API.getStateBulk(args.states);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(ret),
				},
			],
		};
	},
};
