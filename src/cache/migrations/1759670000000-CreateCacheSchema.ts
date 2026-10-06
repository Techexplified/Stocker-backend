import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from "typeorm";

/**
 * Initial cache schema. Uses TypeORM's Table API, which generates the correct
 * DDL for SQLite, MySQL and PostgreSQL from a single definition.
 */
export class CreateCacheSchema1759670000000 implements MigrationInterface {
  name = "CreateCacheSchema1759670000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existingTable = await queryRunner.getTable("query_cache");
    if (existingTable && !existingTable.findColumnByName("key_hash")) {
      // Legacy pre-ORM cache schema detected: drop and recreate cleanly
      await queryRunner.dropTable("query_cache_photos", true);
      await queryRunner.dropTable("query_cache", true);
      await queryRunner.dropTable("photos", true);
    }

    const isMysql = ["mysql", "mariadb"].includes(queryRunner.connection.options.type);
    // MySQL's default collation is case-insensitive; provider photo IDs are case-sensitive
    const caseSensitive = isMysql ? { charset: "utf8mb4", collation: "utf8mb4_bin" } : {};
    const epoch = { type: "bigint", isNullable: false } as const;

    await queryRunner.createTable(
      new Table({
        name: "photos",
        columns: [
          { name: "id", type: "varchar", length: "191", isPrimary: true, ...caseSensitive },
          { name: "provider", type: "varchar", length: "32", isNullable: true },
          { name: "url", type: "text" },
          { name: "title", type: "text" },
          { name: "category", type: "text" },
          { name: "aspect_ratio", type: "varchar", length: "16" },
          { name: "dimensions", type: "varchar", length: "64" },
          { name: "dominant_color", type: "varchar", length: "32" },
          { name: "author_name", type: "text", isNullable: true },
          { name: "author_username", type: "text", isNullable: true },
          { name: "author_link", type: "text", isNullable: true },
          { name: "download_location", type: "text", isNullable: true },
          { name: "first_seen_at", ...epoch },
          { name: "updated_at", ...epoch },
        ],
        indices: [new TableIndex({ name: "idx_photos_provider", columnNames: ["provider"] })],
      }),
      true
    );

    await queryRunner.createTable(
      new Table({
        name: "query_cache",
        columns: [
          { name: "id", type: "integer", isPrimary: true, isGenerated: true, generationStrategy: "increment" },
          { name: "key_hash", type: "varchar", length: "64" },
          { name: "cache_key", type: "text" },
          { name: "endpoint", type: "varchar", length: "16" },
          { name: "provider", type: "varchar", length: "32" },
          { name: "query", type: "text" },
          { name: "page", type: "integer" },
          { name: "per_page", type: "integer" },
          { name: "orientation", type: "varchar", length: "16", isNullable: true },
          { name: "color", type: "varchar", length: "32", isNullable: true },
          { name: "ratio", type: "varchar", length: "16", isNullable: true },
          { name: "result_provider", type: "varchar", length: "32" },
          { name: "is_fallback", type: "boolean", default: "false" },
          { name: "warning", type: "text", isNullable: true },
          { name: "photo_count", type: "integer", default: "0" },
          { name: "created_at", ...epoch },
          { name: "expires_at", ...epoch },
          { name: "hit_count", type: "integer", default: "0" },
          { name: "last_accessed_at", ...epoch },
        ],
        indices: [
          new TableIndex({ name: "uq_query_cache_key_hash", columnNames: ["key_hash"], isUnique: true }),
          new TableIndex({ name: "idx_query_cache_expires", columnNames: ["expires_at"] }),
          new TableIndex({ name: "idx_query_cache_endpoint", columnNames: ["endpoint", "provider"] }),
          new TableIndex({ name: "idx_query_cache_lru", columnNames: ["last_accessed_at"] }),
        ],
      }),
      true
    );

    await queryRunner.createTable(
      new Table({
        name: "query_cache_photos",
        columns: [
          { name: "cache_id", type: "integer", isPrimary: true },
          { name: "position", type: "integer", isPrimary: true },
          { name: "photo_id", type: "varchar", length: "191", ...caseSensitive },
          { name: "provider", type: "varchar", length: "32", isNullable: true },
          { name: "aspect_ratio", type: "varchar", length: "16", isNullable: true },
          { name: "match_score", type: "double precision", isNullable: true },
          { name: "is_fallback", type: "boolean", default: "false" },
          { name: "fallback_reason", type: "text", isNullable: true },
        ],
        indices: [new TableIndex({ name: "idx_query_cache_photos_photo", columnNames: ["photo_id"] })],
        foreignKeys: [
          new TableForeignKey({
            name: "fk_qcp_cache",
            columnNames: ["cache_id"],
            referencedTableName: "query_cache",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
          new TableForeignKey({
            name: "fk_qcp_photo",
            columnNames: ["photo_id"],
            referencedTableName: "photos",
            referencedColumnNames: ["id"],
            onDelete: "CASCADE",
          }),
        ],
      }),
      true
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("query_cache_photos", true);
    await queryRunner.dropTable("query_cache", true);
    await queryRunner.dropTable("photos", true);
  }
}
