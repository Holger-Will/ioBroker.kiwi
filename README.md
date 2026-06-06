# ioBroker.kiwi

[![Downloads](https://img.shields.io/npm/dm/iobroker.kiwi.svg)](https://www.npmjs.com/package/iobroker.kiwi) - [![Test and Release](https://github.com/Holger-Will/ioBroker.kiwi/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/Holger-Will/ioBroker.kiwi/actions/workflows/test-and-release.yml)
**Beta version. need more testing!**

## Connecting

The following settings work in modern MCP clients like VSCode or Claude Desktop etc.

```json
{
	"servers": {
		"iobroker-remote": {
			"type": "http",
			"url": "http://192.168.178.38:8082/kiwi/0/mcp",
			"headers": { "cache-control": "no-cache" }
		}
	}
}
```

for older clients that only support sse and stdio you can use mcp-remote

```json
{
	"servers": {
		"iobroker-remote": {
			"type": "stdio",
			"command": "npx",
			"args": ["-y", "mcp-remote", "http://<your-iobroker-ip>:<web-adapter-port>/kiwi/0/mcp", "--allow-http"]
		}
	}
}
```

## ioBroker

you can use it from inside iobroker with two states:

- kiwi.0.chat.prompt
- kiwi.0.chat.response

or in javascript adpater

```
function getAiResponse(txt){
    return new Promise((resolve,reject)=>{
        once("kiwi.0.chat.response",data=>{
            resolve(data.state.val)
        })
        setState("kiwi.0.chat.prompt",txt)
    })
}
```

and then

```
console.log(await getAIResponse("helllo"))
```

## Basic Usage

you add descriptions to states with custom configs.

![image](https://github.com/user-attachments/assets/2a2c5aab-afb1-49a8-866c-323f01a23e28)

the description will be turned into vector embeddings and stored in a vector database.

you can then say: "switch the test state to false" or "set test to false" or something along these lines. This is language-agnostic because it will match the semantic meaning. So you can describe the state in any language and `search` in another language.

you can tell the bot to describe states for you while talking with it about your system. It will use the `describe` MCP tool to enable the custom setting and set a description.

there are other tools the bot can use like setState, getState, setObject, getObject, getHistory, etc.

## MCP Tools

- **search.mjs** – Semantic search for state objects (vector search).
- **describe.mjs** – Set a description for a single object (enables semantic search).
- **describeBulk.mjs** – Set descriptions for multiple objects at once.
- **deleteItemFromIndex.mjs** – Remove an item from the semantic search index.
- ~~**createScene.mjs** – Create a new ioBroker scene (group of state/value pairs).~~
- **mingoSearch** - a search tool for objects in the object database. uses MongoDB style queries.

### low level functions

- **getObject.mjs** – Get a single ioBroker object by ID.
- **setObject.mjs** – Edit or create objects in ioBroker.
- **deleteObject.mjs** – Delete any ioBroker object (device, channel, state, or folder).
- **getState.mjs** – Get the value of a state by ID.
- **getStateBulk.mjs** – Get values of multiple states at once.
- **setState.mjs** – Set the value of a state.
- **setStateBulk.mjs** – Set multiple state values at once.
- ~~**createState.mjs** – Create a new ioBroker state object.~~
- **getAllRooms.mjs** – List all valid rooms and areas.
- **getHistory.mjs** – Retrieve historical state data (time series, trends).
- **getAdapters.mjs** – List all installed adapters in the system.
- ~~**getInstances.mjs** – List all running adapter instances.~~

### file handling

- **readDir.mjs** – Read the contents of a directory in the ioBroker file system.
- **readFile.mjs** – Read the contents of a file in the ioBroker file system.
- **writeFile.mjs** – Write content to a file in the ioBroker file system.
- **fileExists.mjs** – Check if a file exists in the ioBroker file system.
- **mkdir.mjs** – Create a new directory in the ioBroker file system.
- **renameFile.mjs** – Rename a file or directory in the ioBroker file system.
- **deleteFile.mjs** – Delete a file in the ioBroker file system.

## Basic Authentication

get a base64 encoded string gof your username and password

```
console.log(Buffer.from("username:password").toString("base64"))
```

```
{
	"servers": {
		"iobroker-remote": {
			"type": "http",
			"url": "http://localhost:8082/kiwi/0/mcp",
			"headers": {
				"cache-control": "no-cache",
				"authorization": "Basic YOUR_BASE64_ENCODED_STRING_HERER"
			}
		}
	}
}
```

## Changelog

### v0.4.2

- bugfix: await getHistory call

### v0.4.1

- translations
- improve jsonConfig.json
- make mingoSearch find all object types
- reimplement getAdapters
- added file handling
- serve user files to web
- implemented deleteObject

[Older changelogs can be found there](CHANGELOG_OLD.md)

## License

MIT License

Copyright (c) 2025 Holger Will <h.will@klimapartner.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
