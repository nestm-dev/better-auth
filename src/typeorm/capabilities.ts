import { BetterAuthError } from "better-auth";

import type {
	TypeormColumnMetadata,
	TypeormDataSource,
	TypeormEntityManager,
	TypeormEntityMetadata,
	TypeormEntityTarget,
} from "./types.ts";

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function requireColumn(value: unknown): TypeormColumnMetadata {
	if (
		!isRecord(value) ||
		typeof value.propertyName !== "string" ||
		typeof value.databaseName !== "string"
	) {
		throw new BetterAuthError("[TypeORM Adapter] DataSource returned malformed column metadata.");
	}
	return {
		propertyName: value.propertyName,
		databaseName: value.databaseName,
		type: value.type,
	};
}

export function requireEntityMetadata(value: unknown): TypeormEntityMetadata {
	if (
		!isRecord(value) ||
		typeof value.targetName !== "string" ||
		typeof value.tableName !== "string" ||
		(value.schema !== undefined && typeof value.schema !== "string") ||
		!Array.isArray(value.columns)
	) {
		throw new BetterAuthError("[TypeORM Adapter] DataSource returned malformed entity metadata.");
	}
	return {
		targetName: value.targetName,
		tableName: value.tableName,
		...(typeof value.schema === "string" ? { schema: value.schema } : {}),
		columns: value.columns.map(requireColumn),
	};
}

export function getEntityMetadata(
	dataSource: TypeormDataSource,
	target: TypeormEntityTarget,
): TypeormEntityMetadata {
	return requireEntityMetadata(Reflect.apply(dataSource.getMetadata, dataSource, [target]));
}

export function requireEntityManager(value: unknown): TypeormEntityManager {
	if (!isRecord(value) || typeof value.query !== "function") {
		throw new BetterAuthError(
			"[TypeORM Adapter] DataSource transaction returned an invalid EntityManager.",
		);
	}
	const query = value.query;
	return {
		query: (...parameters: never[]) => Reflect.apply(query, value, parameters),
	};
}

export async function executeQuery(
	manager: TypeormEntityManager,
	sql: string,
	parameters: readonly unknown[],
): Promise<unknown> {
	return await Reflect.apply(manager.query, manager, [sql, [...parameters]]);
}
