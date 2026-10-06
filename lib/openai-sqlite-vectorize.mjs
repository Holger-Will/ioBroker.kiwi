import OpenAI from "openai";
import Database from "better-sqlite3";
import { load as sqliteVecLoad } from "sqlite-vec";
import path from "node:path";
import fs from "node:fs";
import murmurhash from "murmurhash3js"; // Use for 32-bit hashing

export class OpenAiVectorDB {
	constructor(options) {
		this.options = options || {};
		// created lazily: the OpenAI client throws without an API key, which must not crash the adapter or web process
		this.openai = null;
		this.dimensionality = options.dimensionality || 3072; // adjust to chosen OpenAI embedding model
		this.modelName = options.modelName || "text-embedding-3-large";
		this.logger = options.logger || console;
		this.dbDirPath = options.dbPath;
		this.dbFileName = options.dbFileName || "openai_vector_store.sqlite";
		this.dbFilePath = path.join(this.dbDirPath, this.dbFileName);
		this.db = null;
		this.insertDocStmt = null;
		this.insertVectorStmt = null;
		this.deleteDocStmt = null;
		this.deleteVectorStmt = null;
		this.getSemanticSearchStmt = null;
		this.getItemStmt = null;
	}

	_generateVecIdFromTextId(textId) {
		const seed = 0;
		return BigInt(murmurhash.x86.hash32(textId, seed));
	}

	async _getEmbedding(text) {
		if (!this.openai) {
			if (!this.options.apiKey) {
				throw new Error("No API key configured. Enter an OpenAI API key in the kiwi instance settings.");
			}
			this.openai = new OpenAI({ apiKey: this.options.apiKey });
		}
		const resp = await this.openai.embeddings.create({
			model: this.modelName,
			input: String(text || ""),
		});
		if (!resp || !resp.data || !resp.data.length || !resp.data[0].embedding) {
			throw new Error(`Failed to get embedding from OpenAI: ${JSON.stringify(resp)}`);
		}
		// embedding is Array<number>
		const arr = resp.data[0].embedding;
		return new Float32Array(arr);
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
			const row = this.db.prepare("select vec_version() as vec_version;").get();
			this.logger.debug(`[Kiwi DB] sqlite-vec version: ${row?.vec_version}`);
		} catch (e) {
			this.logger.error(`[Kiwi DB] Error loading sqlite-vec extension: ${e.message}`);
			throw e;
		}

		this.db.exec(`
            CREATE TABLE IF NOT EXISTS documents (
                iobroker_text_id TEXT PRIMARY KEY,
                vec_id INTEGER UNIQUE,
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
                dv.distance AS similarity_score
            FROM
                documents d
            JOIN
                document_vectors dv ON d.vec_id = dv.rowid
            WHERE
                dv.embedding MATCH ?
                AND dv.k = ?
            ORDER BY
                similarity_score ASC;
        `);
		this.getItemStmt = this.db.prepare(
			"SELECT iobroker_text_id, vec_id FROM documents WHERE iobroker_text_id = ?;",
		);
	}

	async write(iobroker_text_id, txt, metadata = {}) {
		if (!this.db) {
			this.logger.error("[Kiwi DB] Write failed! Database not initialized. Call init() first.");
			return;
		}

		const vector = await this._getEmbedding(txt);
		if (!vector) {
			this.logger.error(`[Kiwi DB] Failed to generate embedding for text: "${txt}"`);
			return;
		}
		const embeddingBuffer = new Uint8Array(vector.buffer);
		const vecId = this._generateVecIdFromTextId(iobroker_text_id); // sqlite rowid fits Number

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
			this.logger.error("[Kiwi DB] Search failed! Database not initialized. Call init() first.");
			return;
		}

		const effectiveLimit = Math.max(1, Math.floor(limit));

		const queryVector = await this._getEmbedding(txt);
		if (!queryVector) {
			this.logger.error(`[Kiwi DB] Failed to generate embedding for text: "${txt}"`);
			return;
		}
		const queryEmbeddingBuffer = new Uint8Array(queryVector.buffer);

		const results = this.getSemanticSearchStmt.all(queryEmbeddingBuffer, effectiveLimit);
		return results.map((row) => ({
			id: row.iobroker_text_id,
			metadata: JSON.parse(row.metadata || "{}"),
			distance: row.similarity_score,
			content: row.content,
			timestamp: row.timestamp,
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
