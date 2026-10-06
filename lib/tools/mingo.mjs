import { z } from "zod";
const DESC = `with this tool you can search the complete ioBroker object database. you can search for type= "object" type="folder" type="channel" type="state" type="script" type="enum" type="device" etc.
this tool is mainly used for maintainace and administration of the ioBroker system, to find state-objects that are not in the semantic search index yet. or find scripts and edit scripts etc.
the sytax is similar to MongoDB's Mingo query language, so you can use operators like $eq, $gt, $lt, $in, etc.
Example queries:
- { "type": "state", "_id": { "$regex": "alias.0.*temperature.*", "$options": "i" } }
- { "type": "state", "common.name": { "$regex": ".*temperature.*", "$options": "i" } }
- { "type": "device", "common.custom.mcp-server.0.description": { "$regex": ".*light.*", "$options": "i" } }
- { "type": "script", "common.name": { "$regex": ".*scene.*", "$options": "i" } }
- { "type": "object", "common.custom.mcp-server":{"$exists": true } }

    `;
export const mingoSearch = {
	name: "mingoSearch",
	desc: DESC,
	params: {
		// accept either an object or a JSON string (n8n often sends a string)
		query: z
			.union([z.record(z.string(), z.any()), z.string()])
			.describe(
				"the query to search for objects in the ioBroker database. Accepts either an object or a JSON string. Syntax like MongoDB/Mingo.",
			),
		limit: z
			.number()
			.optional()
			.default(100)
			.describe(
				"limits the number of objects returned. defaults to 100, set to higher if you want to get more objects.",
			),
		skip: z
			.number()
			.optional()
			.default(0)
			.describe("skips the first n objects in the result set. useful for pagination."),
	},
	call: (API) => async (args) => {
		// normalize query: if string parse JSON, otherwise pass through
		let q = args.query;
		if (typeof q === "string") {
			try {
				q = JSON.parse(q);
			} catch (e) {
				// keep raw string (API will also try to handle), but log
				console.warn("mingoSearch: query is a non-JSON string; passing raw string to API");
			}
		}
		const objects = await API.mingoSearch(q, args.limit, args.skip);
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(objects),
				},
			],
		};
	},
};
