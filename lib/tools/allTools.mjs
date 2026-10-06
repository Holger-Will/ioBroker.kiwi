import { getAdapters } from "./getAdapters.mjs";
import { getRunningInstances } from "./getInstances.mjs";
import { search } from "./search.mjs";
import { getState } from "./getState.mjs";
import { setState } from "./setState.mjs";
import { describe } from "./describe.mjs";
import { setStateBulk } from "./setStateBulk.mjs";
import { createState } from "./createState.mjs";
import { createScene } from "./createScene.mjs";
import { setObject } from "./setObject.mjs";
import { getAllRooms } from "./getAllRooms.mjs";
import { getHistory } from "./getHistory.mjs";
import { listHistoryStates } from "./listHistoryStates.mjs";
import { describeBulk } from "./describeBulk.mjs";
import { deleteItemFromIndex } from "./deleteItemFromIndex.mjs";
import { getObject } from "./getObject.mjs";
import { getStateBulk } from "./getStateBulk.mjs";
import { mingoSearch } from "./mingo.mjs";
import { deleteFile } from "./deleteFile.mjs";
import { fileExists } from "./fileExists.mjs";
import { mkdir } from "./mkdir.mjs";
import { readDir } from "./readDir.mjs";
import { readFile } from "./readFile.mjs";
import { renameFile } from "./renameFile.mjs";
import { writeFile } from "./writeFile.mjs";
import { deleteObject } from "./deleteObject.mjs";
export const Tools = {
	getAdapters,
	getRunningInstances,
	getState,
	setState,
	getStateBulk,
	describe,
	setStateBulk,
	createState,
	createScene,
	setObject,
	getObject,
	deleteObject,
	getAllRooms,
	getHistory,
	listHistoryStates,
	search,
	describeBulk,
	deleteItemFromIndex,
	mingoSearch,
	// File/folder tools
	readDir,
	readFile,
	writeFile,
	fileExists,
	mkdir,
	renameFile,
	deleteFile,
	// Add other tools here as needed
};
