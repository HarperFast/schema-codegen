/** @import { RegenerateClientOptions } from './client/regenerateClient.js' */
import path from 'node:path';
import { collectTables } from './collectTables.js';
import { generateJSDocFromTables } from './generateJSDocFromTables.js';
import { generateTablesDTS } from './generateTablesDTS.js';
import { generateTSFromTables } from './generateTS.js';
import { writeIfChanged } from './writeIfChanged.js';

/**
 * @param {RegenerateClientOptions | undefined} client
 * @returns {client is RegenerateClientOptions}
 */
export function hasClientOutputs(client) {
	return Boolean(client?.schemaIR || client?.swift || client?.kotlin);
}

/**
 * @param {string} globalTypes
 * @param {string} schemaTypes
 * @param {string} [jsdoc]
 * @param {{ module?: string, includeDatabases?: string[], excludeDatabases?: string[], baseDirectory?: string, client?: RegenerateClientOptions }} [options]
 *   `baseDirectory` is what relative output paths resolve against (the application directory);
 *   client outputs are generated, and their modules loaded, only when one is configured.
 */
export async function regenerateAll(globalTypes, schemaTypes, jsdoc, options = {}) {
	const {
		module: moduleName,
		includeDatabases,
		excludeDatabases,
		baseDirectory = '',
		client,
	} = options;
	const list = collectTables({ include: includeDatabases, exclude: excludeDatabases });
	const resolve = (/** @type {string} */ target) => path.resolve(baseDirectory, target);

	if (jsdoc) {
		const { jsCode } = generateJSDocFromTables(list, 'HarperDB schema');
		writeIfChanged(resolve(jsdoc), jsCode);
	}

	const { tsCode, tables } = generateTSFromTables(list, 'HarperDB schema');
	if (schemaTypes) {
		writeIfChanged(resolve(schemaTypes), tsCode);
	}
	if (globalTypes) {
		generateTablesDTS(resolve(globalTypes), resolve(schemaTypes), tables, moduleName);
	}

	if (hasClientOutputs(client)) {
		const { regenerateClient } = await import('./client/regenerateClient.js');
		await regenerateClient(list, { baseDirectory, ...client });
	}
}
