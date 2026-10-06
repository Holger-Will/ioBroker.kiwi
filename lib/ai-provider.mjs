// Selection of the AI provider (instance setting `aiProvider`) for chat and embeddings
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { OpenAiVectorDB } from "./openai-sqlite-vectorize.mjs";
import { VectorDB as GeminiVectorDB } from "./sqlite-vectorize.mjs";

export const DEFAULT_PROVIDER = "openai";

export const PROVIDERS = {
	openai: {
		label: "OpenAI",
		defaultModel: "gpt-5-mini",
		// one store file per provider: the vector dimension differs between embedding models
		createVectorDB: (options) => new OpenAiVectorDB({ ...options, dbFileName: "openai_vector_store.sqlite" }),
		isModel: (id) => isOpenAiChatModel(id),
	},
	gemini: {
		label: "Google Gemini",
		defaultModel: "gemini-2.5-flash",
		createVectorDB: (options) => new GeminiVectorDB({ ...options, dbFileName: "vector_store.sqlite" }),
		isModel: (id) => /^(models\/)?gemini/.test(id),
	},
};

/**
 * @param {string} [provider] value of the instance setting `aiProvider`
 * @returns {string} a known provider id, falls back to the default
 */
export function normalizeProvider(provider) {
	return provider && PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
}

/**
 * The configured model if it belongs to the provider, otherwise the provider's default model.
 * Protects against a model left over from the other provider after switching.
 *
 * @param {string} provider
 * @param {string} [model]
 */
export function resolveModel(provider, model) {
	const p = PROVIDERS[normalizeProvider(provider)];
	return model && p.isModel(model) ? model : p.defaultModel;
}

/**
 * @param {{ provider?: string, apiKey?: string, namespace?: string, dbPath: string, logger?: any }} options
 */
export function createVectorDB(options) {
	return PROVIDERS[normalizeProvider(options.provider)].createVectorDB(options);
}

/**
 * Lists the chat models of a provider for the model selection in the instance settings.
 *
 * @param {string} provider
 * @param {string} apiKey
 * @returns {Promise<Array<{ value: string, label: string }>>}
 */
export async function listChatModels(provider, apiKey) {
	const models = [];
	if (normalizeProvider(provider) === "gemini") {
		const pager = await new GoogleGenAI({ apiKey }).models.list();
		for await (const m of pager) {
			if (m.supportedActions && m.supportedActions.includes("generateContent")) {
				models.push({ value: m.name || "", label: m.displayName || m.name || "none" });
			}
		}
	} else {
		for await (const m of new OpenAI({ apiKey }).models.list()) {
			if (isOpenAiChatModel(m.id)) {
				models.push({ value: m.id, label: m.id });
			}
		}
		models.sort((a, b) => a.value.localeCompare(b.value));
	}
	return models;
}

function isOpenAiChatModel(id) {
	return (
		/^(gpt-|o\d|chatgpt-)/.test(id) &&
		!/(audio|image|realtime|transcribe|tts|whisper|search|embedding|live|moderation|translate|instruct)/.test(id)
	);
}
