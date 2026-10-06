import { z } from "zod";
const DESC = `Edit or create objects in the ioBroker system.

- Only fields you supply will be changed; others remain untouched.
- If the object does not exist, it will be created.
- To delete a field, set its value to null.
- You can change name, type, common properties, enums, native properties, and more.
- Useful for creating new objects, editing existing ones, or removing fields.

Example: Add members to a scene:
id: 0_userdata.0.mcp_server.scenes.test
obj: {
  native: {
      members: [
            { id: 'javascript.0.newState', value: '1' },
            { id: 'javascript.0.newState1', value: '2' }
        ]
    }

}
    
with setObject you can even create your own automation scripts. exaple:
{id:"script.js.mcp_scene_script",obj:{
            "type": "script",
            "common": {
            "name": "mcp_scene_script",
            "expert": true,
            "engineType": "Javascript/js",
            "enabled": true,
            "engine": "system.adapter.javascript.0",
            "source": "on(/^0_userdata.0.mcp_server.scene.*/,data=>{\r\n    if(data.state.val ==true){\r\n        setState(data.id,false,true)\r\n        let obj = getObject(data.id)\r\n        obj.native.members.forEach(m=>{\r\n            setState(m.id,m.value)\r\n        })\r\n    }\r\n})",
            "debug": false,
            "verbose": false
            },
            "native": {}
        }}`;
export const setObject = {
	name: "setObject",
	desc: DESC,
	params: {
		id: z
			.string()
			.describe(
				"The ID of the object to get. This is usually in the format {instance}.{adapter}.{name} (e.g., 'hue.0.brightness').",
			),
		obj: z
			.record(z.string(), z.any())
			.describe(
				"The object to set for the state.example: {type: 'state', common: {name: 'Brightness', type: 'number', role: 'level.brightness'}, native: {}, acl: {read: true, write: true}}",
			),
	},
	call: (API) => async (args) => {
		const ret = await API.setObject(args);
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
