import path from 'node:path';
import { collectTables } from './collectTables.js';
import { generateJSDocFromTables } from './generateJSDocFromTables.js';
import { generateTablesDTS } from './generateTablesDTS.js';
import { generateTSFromTables } from './generateTS.js';
import { writeIfChanged } from './writeIfChanged.js';

/**
 * @param {string} globalTypes
 * @param {string} schemaTypes
 * @param {string} [jsdoc]
 * @param {{ module?: string, includeDatabases?: string[], excludeDatabases?: string[] }} [options]
 */
export function regenerateAll(globalTypes, schemaTypes, jsdoc, options = {}) {
	const { module: moduleName, includeDatabases, excludeDatabases } = options;
	const list = collectTables({ include: includeDatabases, exclude: excludeDatabases });

	if (jsdoc) {
		const { jsCode } = generateJSDocFromTables(list, 'HarperDB schema');
		writeIfChanged(path.resolve(jsdoc), jsCode);
	}

	const { tsCode, tables } = generateTSFromTables(list, 'HarperDB schema');
	if (schemaTypes) {
		writeIfChanged(path.resolve(schemaTypes), tsCode);
	}
	if (globalTypes) {
		generateTablesDTS(path.resolve(globalTypes), path.resolve(schemaTypes), tables, moduleName);
	}
}
