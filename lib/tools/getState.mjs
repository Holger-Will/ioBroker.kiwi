import { z } from "zod";
const DESC = `get the value of states in the ioBroker system. returns an array of state value objects. you can add the withInfo parameter to 
    You can specify the state by its ID, which is usually in the format {instance}.{adapter}.{state} (e.g., 'hue.0.deviceId.brightness') allows for wildcards 'hue.0.deviceId.*' or 'hue.0.*.brightness'."
    when you provide the withInfo parameter, the result will include additional information about the state, such as its type, common properties, and enums.
    if you are interested in just the states info and not its value, you can use getObject
	examples:
	- getState({ id: "hue.0.deviceId.brightness", withInfo: true })	
	- getState({ id: "hue.0.deviceId.*", withInfo: true })
	- getState({ id: "hue.0.*.brightness", withInfo: true })
	- getState({ id: "hue.0.*", withInfo: false })
    `;
export const getState = {
	name: "getIobrokerState",
	desc: DESC,
	params: {
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
	},
	call: (API) => async (args) => {
		const instances = await API.getState(args);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(instances),
				},
			],
		};
	},
};
