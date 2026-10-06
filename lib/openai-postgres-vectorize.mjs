// VectorDB implementation using OpenAI embeddings + Postgres (pgvector)
// Prereqs: Postgres with "vector" extension, npm packages: openai, pg
import OpenAI from "openai";
import { Client } from "pg";

export class PGOpenAiVectorDB {
	constructor(options) {
		this.options = options || {};
		this.openai = new OpenAI({ apiKey: options.apiKey });
		this.modelName = options.modelName || "text-embedding-3-large";
		this.dimensionality = options.dimensionality || 3072; // OpenAI embedding dim default (adjust to model)
		this.logger = options.logger || console;
		this.pgConfig = options.pgConfig || {
			connectionString: options.connectionString || "postgres://homeserver1:5432/postgres",
		};
		this.client = null;
		this.tableName = options.tableName || "iobroker_vector_store";
	}

	async init() {
		if (this.client) {
			this.logger.info("[VectorDB] Postgres client already initialized.");
			return;
		}
		this.client = new Client(this.pgConfig);
		await this.client.connect();

		// Ensure vector extension and table exist
		try {
			await this.client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
		} catch (e) {
			this.logger.warn(
				"[VectorDB] Could not create/verify pg vector extension (maybe already present): " + e.message,
			);
		}

		const createTableSql = `
            CREATE TABLE IF NOT EXISTS ${this.tableName} (
                iobroker_text_id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                timestamp BIGINT,
                metadata JSONB,
                embedding vector(${this.dimensionality})
            );
        `;
		await this.client.query(createTableSql);

		// Optional: create ivfflat index for faster nearest-neighbor searches (requires proper vector ops and setup)
		try {
			await this.client.query(
				`CREATE INDEX IF NOT EXISTS idx_${this.tableName}_embedding ON ${this.tableName} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`,
			);
		} catch (e) {
			// index creation may fail if server not configured for ivfflat; not fatal
			this.logger.debug("[VectorDB] ivfflat index creation skipped/failed: " + e.message);
		}

		this.logger.info("[VectorDB] Postgres/pgvector initialized.");
	}

	async _getEmbedding(text) {
		const resp = await this.openai.embeddings.create({
			model: this.modelName,
			input: text,
		});
		if (!resp || !resp.data || !resp.data.length || !resp.data[0].embedding) {
			throw new Error("Failed to get embedding from OpenAI: " + JSON.stringify(resp));
		}
		return resp.data[0].embedding; // Array<number>
	}

	// Upsert document + embedding
	async write(iobroker_text_id, txt, metadata = {}) {
		if (!this.client) {
			this.logger.error("[VectorDB] write failed: DB not initialized. Call init() first.");
			return;
		}
		const embedding = await this._getEmbedding(String(txt || ""));
		// convert to Postgres vector literal: '[v1,v2,...]'
		const embLiteral = `[${embedding.join(",")}]`;

		const sql = `
            INSERT INTO ${this.tableName} (iobroker_text_id, content, timestamp, metadata, embedding)
            VALUES ($1, $2, $3, $4, $5::vector)
            ON CONFLICT (iobroker_text_id) DO UPDATE
              SET content = EXCLUDED.content,
                  timestamp = EXCLUDED.timestamp,
                  metadata = EXCLUDED.metadata,
                  embedding = EXCLUDED.embedding;
        `;
		try {
			await this.client.query(sql, [iobroker_text_id, txt, Date.now(), JSON.stringify(metadata), embLiteral]);
			return { id: iobroker_text_id, status: "upserted" };
		} catch (e) {
			this.logger.error("[VectorDB] write failed: " + e.message);
			throw e;
		}
	}

	// Nearest neighbor search using cosine distance (<#> operator)
	async find(txt, limit = 10) {
		if (!this.client) {
			this.logger.error("[VectorDB] find failed: DB not initialized. Call init() first.");
			return;
		}
		const embedding = await this._getEmbedding(String(txt || ""));
		const embLiteral = `[${embedding.join(",")}]`;

		const sql = `
            SELECT iobroker_text_id, content, metadata, timestamp, embedding <#> $1::vector AS similarity_score
            FROM ${this.tableName}
            ORDER BY similarity_score ASC
            LIMIT $2;
        `;
		const res = await this.client.query(sql, [embLiteral, Math.max(1, Math.floor(limit))]);
		return res.rows.map((r) => ({
			id: r.iobroker_text_id,
			metadata: r.metadata,
			distance: r.similarity_score,
			content: r.content,
			timestamp: r.timestamp,
		}));
	}

	async deleteItem(iobroker_text_id) {
		if (!this.client) {
			this.logger.error("[VectorDB] deleteItem failed: DB not initialized. Call init() first.");
			return false;
		}
		const res = await this.client.query(
			`DELETE FROM ${this.tableName} WHERE iobroker_text_id = $1 RETURNING iobroker_text_id;`,
			[iobroker_text_id],
		);
		if (res.rowCount > 0) {
			this.logger.info(`[VectorDB] Deleted item ${iobroker_text_id}`);
			return true;
		}
		return false;
	}

	async getItem(iobroker_text_id) {
		if (!this.client) return null;
		const res = await this.client.query(
			`SELECT iobroker_text_id, timestamp, metadata FROM ${this.tableName} WHERE iobroker_text_id = $1;`,
			[iobroker_text_id],
		);
		return res.rows[0] || null;
	}

	async close() {
		if (this.client) {
			await this.client.end();
			this.client = null;
			this.logger.info("[VectorDB] Postgres connection closed.");
		}
	}
}
