# ioBroker.kiwi

[![Test and Release](https://github.com/michiproep/ioBroker.kiwi/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/michiproep/ioBroker.kiwi/actions/workflows/test-and-release.yml)

**Beta version. need more testing!**

An MCP server that lets any MCP client (Claude Desktop, VS Code, …) control ioBroker, plus an integrated AI chat bot
and semantic search over your states.

> **Fork notice:** this is a maintained fork of the no longer maintained
> [Holger-Will/ioBroker.kiwi](https://github.com/Holger-Will/ioBroker.kiwi). The npm package `iobroker.kiwi`
> (0.4.2) is still the upstream version. Releases of this fork are published as
> [GitHub releases](https://github.com/michiproep/ioBroker.kiwi/releases).
> See [CONTRIBUTING.md](CONTRIBUTING.md) for the branching and release process.

## Requirements

- Node.js >= 22, js-controller >= 6.0.11, admin >= 7.6.20 and a web adapter instance (serves the MCP endpoint)
- 64-bit system (x64 or arm64; Linux, Windows or macOS). 32-bit ARM (for example Raspberry Pi OS 32-bit) is not
  supported, because the native module `sqlite-vec` has no build for it.
- An API key, see [AI and vector store integration status](#ai-and-vector-store-integration-status). Without a key the
  adapter starts, but semantic search and the chat bot are disabled.

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

## AI and vector store integration status

Choose the **AI provider** in the instance settings. The API key must belong to the selected provider; it is used for
the integrated chat bot **and** for the embeddings of the semantic search.

| Setting      | OpenAI (default)                                      | Google Gemini                                  |
| ------------ | ----------------------------------------------------- | ---------------------------------------------- |
| Chat model   | selectable, default `gpt-5-mini` (Responses API)      | selectable, default `gemini-2.5-flash`         |
| Embeddings   | `text-embedding-3-large` (3072 dims)                  | `gemini-embedding-001` (768 dims)              |
| Vector store | `openai_vector_store.sqlite` in the instance data dir | `vector_store.sqlite` in the instance data dir |

The model dropdown lists the models of the selected provider (enter the key first). Leave it empty to use the default.
Each provider has its own vector store file. After switching the provider, the adapter adds all described states that
are missing in the new store on startup, so nothing has to be deleted by hand.

Overview of what is active and what is only prepared:

| Area                                                  | Implementation                                                                                                                                            | Status                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP server (HTTP, streamable)                         | `lib/mcp-web.mjs`, served by the **web adapter** at `/kiwi/<instance>/mcp`                                                                                | **active**                                                                                                                                                                                                                                          |
| Integrated chat bot (`chat.prompt` / `chat.response`) | `lib/chatbot.mjs` + `lib/chat-engines.mjs`: OpenAI (function calling) or Gemini (`mcpToTool`), tools passed through an in-process MCP client              | **active**                                                                                                                                                                                                                                          |
| Semantic state search                                 | OpenAI or Gemini embeddings + SQLite with `sqlite-vec` (`lib/openai-sqlite-vectorize.mjs`, `lib/sqlite-vectorize.mjs`, selected in `lib/ai-provider.mjs`) | **active**                                                                                                                                                                                                                                          |
| Object search                                         | MongoDB-style queries over all ioBroker objects with `mingo` (`mingoSearch` tool, also used as filter for semantic search results)                        | **active**                                                                                                                                                                                                                                          |
| OpenAI embeddings + Postgres                          | `pgvector` table `iobroker_vector_store` (`lib/openai-postgres-vectorize.mjs`)                                                                            | prepared, not used: never instantiated, no admin settings, connection string only via constructor option (hard-coded default `postgres://homeserver1:5432/postgres`). The ivfflat index cannot be created for 3072 dimensions (pgvector limit 2000) |
| Web chat UI                                           | `lib/public/` (`/kiwi/<instance>/index.html`)                                                                                                             | prepared, not functional: the page sends messages over socket.io but nothing in the adapter answers them                                                                                                                                            |

Using an external MCP client (Claude Desktop, VS Code, …) works with either provider; the provider is then only used
for the semantic search embeddings.

## MCP Tools

Tool names as the MCP client sees them (source file in brackets).

- **searchIobrokerStates** (`search.mjs`) – Semantic search for state objects (vector search).
- **describe** (`describe.mjs`) – Set a description for a single object (enables semantic search).
- **describeBulk** (`describeBulk.mjs`) – Set descriptions for multiple objects at once.
- **deleteItemFromIndex** (`deleteItemFromIndex.mjs`) – Remove an item from the semantic search index.
- **mingoSearch** (`mingo.mjs`) – Search the object database with MongoDB-style queries.

### low level functions

- **getObject** (`getObject.mjs`) – Get a single ioBroker object by ID.
- **setObject** (`setObject.mjs`) – Edit or create objects in ioBroker.
- **deleteObject** (`deleteObject.mjs`) – Delete any ioBroker object (device, channel, state, or folder).
- **getIobrokerState** (`getState.mjs`) – Get the value of a state by ID (wildcards allowed).
- **getIobrokerStateBulk** (`getStateBulk.mjs`) – Get values of multiple states at once.
- **setState** (`setState.mjs`) – Set the value of a state.
- **setStateBulk** (`setStateBulk.mjs`) – Set multiple state values at once.
- **getAllRooms** (`getAllRooms.mjs`) – List all valid rooms and areas.
- **getHistory** (`getHistory.mjs`) – Historical values with ready-made statistics (min, max, average, time-weighted average, delta, meter increase) and optional values per interval. Times as text (`-24h`, `yesterday`, `2026-10-01 08:00`); the history adapter (history, sql, influxdb) is detected from the state.
- **listHistoryStates** (`listHistoryStates.mjs`) – List states that have history enabled, with name, unit and history instance.
- **getAdapters** (`getAdapters.mjs`) – List all installed adapters in the system.
- **getRunningInstances** (`getInstances.mjs`) – List adapter instance objects (all instances, not only running ones).

Registered but not implemented (they only return "not implemented"):

- **createState** (`createState.mjs`) – use `setObject` instead.
- **createScene** (`createScene.mjs`) – create an ioBroker scene.

### file handling

- **readDir** (`readDir.mjs`) – Read the contents of a directory in the ioBroker file system.
- **readFile** (`readFile.mjs`) – Read the contents of a file in the ioBroker file system.
- **writeFile** (`writeFile.mjs`) – Write content to a file in the ioBroker file system.
- **fileExists** (`fileExists.mjs`) – Check if a file exists in the ioBroker file system.
- **mkdir** (`mkdir.mjs`) – Create a new directory in the ioBroker file system.
- **renameFile** (`renameFile.mjs`) – Rename a file or directory in the ioBroker file system.
- **deleteFile** (`deleteFile.mjs`) – Delete a file in the ioBroker file system.

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

<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 0.6.1 (2026-10-06)

- (michiproep) removed the non-functional Webhook URL setting
- (michiproep) **getHistory reworked:** detects the history adapter of the state, times as text (`-24h`, `yesterday`, dates), statistics computed by the adapter (incl. meter consumption), values per interval, clear error messages and timeouts instead of empty results
- (michiproep) new tool **listHistoryStates**: find states that have history
- (michiproep) getHistory follows aliases (`alias.0.*`) to the logged target state and loads long ranges (e.g. a whole year) completely

### 0.6.0 (2026-10-06)

- (michiproep) documented the AI and vector store integration status, branching and release process
- (michiproep) **Breaking:** Node.js >= 22 and admin >= 7.6.20 required
- (michiproep) dependencies updated (Gemini SDK 2, OpenAI SDK 7, better-sqlite3 12.11, MCP SDK 1.32, zod 4, mingo 7)
- (michiproep) fix: adapter no longer crashes in a loop when no API key is configured
- (michiproep) CI: tests on Node.js 22/24/26 (Windows only for releases), GitHub release on tag, new Dependabot auto-merge workflow
- (michiproep) new setting **AI provider** (OpenAI default, Google Gemini): the API key is used for chat and embeddings of the selected provider; model list per provider; OpenAI chat with tool calling
- (michiproep) fix: the MCP endpoint (web extension) now decrypts the stored API key

### 0.4.2

- bugfix: await getHistory call

### 0.4.1

- translations
- improve jsonConfig.json
- make mingoSearch find all object types
- reimplement getAdapters
- added file handling
- serve user files to web
- implemented deleteObject

## License

MIT License

Copyright (c) 2025 Holger Will <h.will@klimapartner.de>
Copyright (c) 2025-2026 Michael Pröpster <imp@outlook.de>

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
