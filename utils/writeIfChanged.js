import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from './logger.js';

/**
 * @param {string} filePath
 * @param {string} content
 */
export function writeIfChanged(filePath, content) {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
	if (existing !== content) {
		fs.writeFileSync(filePath, content, 'utf8');
		getLogger()?.debug?.(`Updated types in ${filePath}`);
	}
}
