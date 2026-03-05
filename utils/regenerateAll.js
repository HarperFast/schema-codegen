import path from 'path';
import { collectTables } from './collectTables.js';
import { generateJSDocFromTables } from './generateJSDocFromTables.js';
import { generateTablesDTS } from './generateTablesDTS.js';
import { generateTSFromTables } from './generateTS.js';
import { writeIfChanged } from './writeIfChanged.js';

/**
 * @param {string} globalTypes
 * @param {string} schemaTypes
 * @param {string} [jsdoc]
 */
export function regenerateAll(globalTypes, schemaTypes, jsdoc) {
	const list = collectTables();

	if (jsdoc) {
		const { jsCode } = generateJSDocFromTables(list, 'HarperDB schema');
		writeIfChanged(path.resolve(jsdoc), jsCode);
	} else {
		const { tsCode, tables } = generateTSFromTables(list, 'HarperDB schema');
		writeIfChanged(path.resolve(schemaTypes), tsCode);
		generateTablesDTS(path.resolve(globalTypes), path.resolve(schemaTypes), tables);
	}
}
