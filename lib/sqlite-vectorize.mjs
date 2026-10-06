// VectorDB using Google Gemini embeddings + SQLite/sqlite-vec (MurmurHash3 for 32-bit vec_id)
import { GoogleGenAI } from "@google/genai";
import Database from "better-sqlite3";
import { load as sqliteVecLoad } from "sqlite-vec";
import path from "node:path";
import fs from "node:fs";
import murmurhash from "murmurhash3js"; // Use for 32-bit hashing

export class VectorDB {
	constructor(options) {
		this.options = options || {};
		// created lazily: no API key must not crash the adapter or web process
		this.ai = null;
		this.dimensionality = options.dimensionality || 768;
		this.modelName = options.modelName || "gemini-embedding-001";
		this.logger = options.logger || console;
		this.dbDirPath = options.dbPath;
		this.dbFileName = options.dbFileName || "vector_store.sqlite";
		this.dbFilePath = path.join(this.dbDirPath, this.dbFileName);
		this.db = null;
		this.insertDocStmt = null;
		this.insertVectorStmt = null;
		this.deleteDocStmt = null;
		this.deleteVectorStmt = null;
		this.getSemanticSearchStmt = null;
		this.getItemStmt = null;
	}

	/**
	 * Helper to generate a 32-bit integer hash from a string.
	 * @param {string} textId The string ID to hash.
	 * @returns {bigint} A 32-bit integer hash (standard JavaScript Number).
	 */
	_generateVecIdFromTextId(textId) {
		const seed = 0;
		return BigInt(murmurhash.x86.hash32(textId, seed));
	}

	modelConfig(retrievOrSet, text) {
		return {
			model: this.modelName,
			contents: text,
			config: {
				taskType: retrievOrSet === "set" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY",
				outputDimensionality: this.dimensionality,
			},
		};
	}

	_client() {
		if (!this.ai) {
			if (!this.options.apiKey) {
				throw new Error("No API key configured. Enter a Google Gemini API key in the kiwi instance settings.");
			}
			this.ai = new GoogleGenAI({ apiKey: this.options.apiKey });
		}
		return this.ai;
	}

	async get_index_vectors(text) {
		const result = await this._client().models.embedContent(this.modelConfig("set", text));
		if (!result || !result.embeddings || !result.embeddings.length || !result.embeddings[0].values) {
			throw new Error(
				`Failed to generate indexing embedding for text: "${text}". Result: ${JSON.stringify(result)}`,
			);
		}
		return new Float32Array(result.embeddings[0].values);
	}

	async get_retrive_vectors(text) {
		const result = await this._client().models.embedContent(this.modelConfig("get", text));
		if (!result || !result.embeddings || !result.embeddings.length || !result.embeddings[0].values) {
			throw new Error(
				`Failed to generate retrieval embedding for text: "${text}". Result: ${JSON.stringify(result)}`,
			);
		}
		return new Float32Array(result.embeddings[0].values);
	}

	async init() {
		if (this.db) {
			this.logger.info("[Kiwi DB] Database already initialized.");
			return;
		}

		if (!fs.existsSync(this.dbDirPath)) {
			fs.mkdirSync(this.dbDirPath, { recursive: true });
			this.logger.info(`[Kiwi DB] Created database directory: ${this.dbDirPath}`);
		}

		this.db = new Database(this.dbFilePath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");

		try {
			sqliteVecLoad(this.db);
			const { vec_version } = this.db.prepare("select vec_version() as vec_version;").get();
			this.logger.debug(`[Kiwi DB] sqlite-vec version: ${vec_version}`);
		} catch (e) {
			this.logger.error(`[Kiwi DB] Error loading sqlite-vec extension: ${e.message}`);
			throw e;
		}

		this.db.exec(`
            CREATE TABLE IF NOT EXISTS documents (
                iobroker_text_id TEXT PRIMARY KEY,
                vec_id INTEGER UNIQUE, -- Now populated by hashing (32-bit int)
                content TEXT NOT NULL,
                timestamp INTEGER,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_documents_vec_id ON documents (vec_id);
        `);

		this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS document_vectors USING vec0(
                embedding FLOAT[${this.dimensionality}] DISTANCE_METRIC=COSINE
            );
        `);

		this.logger.info("[Kiwi DB] SQLite tables initialized/verified.");

		this.insertDocStmt = this.db.prepare(`
            INSERT OR REPLACE INTO documents (iobroker_text_id, vec_id, content, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?);
        `);
		this.insertVectorStmt = this.db.prepare(`
            INSERT INTO document_vectors (rowid, embedding) VALUES (?, ?);
        `);
		this.deleteDocStmt = this.db.prepare("DELETE FROM documents WHERE iobroker_text_id = ?;");
		this.deleteVectorStmt = this.db.prepare("DELETE FROM document_vectors WHERE rowid = ?;");

		this.getSemanticSearchStmt = this.db.prepare(`
            SELECT
                d.iobroker_text_id,
                d.content,
                d.timestamp,
                d.metadata,
                dv.distance AS similarity_score -- 'distance' is provided by vec0 when k is specified
            FROM
                documents d
            JOIN
                document_vectors dv ON d.vec_id = dv.rowid
            WHERE
                dv.embedding MATCH ? -- Parameter 1: The query embedding (Uint8Array)
                AND dv.k = ?        -- Parameter 2: The 'k' (number of neighbors)
            ORDER BY
                similarity_score ASC;
        `);
		this.getItemStmt = this.db.prepare(
			"SELECT iobroker_text_id, vec_id FROM documents WHERE iobroker_text_id = ?;",
		);
	}

	async write(iobroker_text_id, txt, metadata) {
		if (!this.db) {
			this.logger.error("[Kiwi DB] Write failed! Database not initialized. Call init() first.");
			return;
		}

		const vector = await this.get_index_vectors(txt);
		if (!vector) {
			this.logger.error(`[Kiwi DB]Failed to generate embedding for text: "${txt}"`);
			return;
		}

		const embeddingBuffer = new Uint8Array(vector.buffer);
		const vecId = this._generateVecIdFromTextId(iobroker_text_id);

		const existingDoc = this.getItemStmt.get(iobroker_text_id);
		const isUpdate = !!existingDoc;

		const runTransaction = this.db.transaction(() => {
			this.insertDocStmt.run(iobroker_text_id, vecId, txt, Date.now(), JSON.stringify(metadata));
			if (isUpdate) {
				this.deleteVectorStmt.run(vecId);
			}
			this.insertVectorStmt.run(vecId, embeddingBuffer);
		});
		runTransaction();

		return { id: iobroker_text_id, vec_id: vecId, status: "upserted" };
	}

	async find(txt, limit = 10) {
		if (!this.db) {
			this.logger.error("[Kiwi DB] Write failed! Database not initialized. Call init() first.");
			return;
		}

		const effectiveLimit = Math.max(1, Math.floor(limit));

		const queryVector = await this.get_retrive_vectors(txt);
		if (!queryVector) {
			this.logger.error(`[Kiwi DB]Failed to generate embedding for text: "${txt}"`);
			return;
		}
		const queryEmbeddingBuffer = new Uint8Array(queryVector.buffer);

		const results = this.getSemanticSearchStmt.all(queryEmbeddingBuffer, effectiveLimit);
		return results.map((row) => ({
			id: row.iobroker_text_id,
			metadata: JSON.parse(row.metadata),
			distance: row.similarity_score,
		}));
	}

	has(iobroker_text_id) {
		return !!(this.db && this.getItemStmt.get(iobroker_text_id));
	}

	async deleteItem(iobroker_text_id) {
		if (!this.db) {
			this.logger.error("[Kiwi DB] Database not initialized. Call init() first.");
		}

		const existingDoc = this.getItemStmt.get(iobroker_text_id);
		if (!existingDoc) {
			//this.logger.info(`[Kiwi DB] Item with ID ${iobroker_text_id} not found for deletion.`);
			return false;
		}

		const vecIdToDelete = existingDoc.vec_id;

		const runTransaction = this.db.transaction(() => {
			this.deleteDocStmt.run(iobroker_text_id);
			this.deleteVectorStmt.run(vecIdToDelete);
		});

		runTransaction();
		this.logger.info(`[Kiwi DB] Item with ID ${iobroker_text_id} deleted.`);
		return true;
	}

	close() {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.insertDocStmt = null;
			this.insertVectorStmt = null;
			this.deleteDocStmt = null;
			this.deleteVectorStmt = null;
			this.getSemanticSearchStmt = null;
			this.getItemStmt = null;
			this.logger.info("[Kiwi DB] SQLite database connection closed.");
		}
	}
}
