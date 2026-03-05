import fs from 'fs';
import path from 'path';
import { getLogger } from './logger.js';

/**
 * @param {string} filePath
 * @param {string} content
 */
export function writeIfChanged(filePath, content) {
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
	const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
	if (existing !== content) {
		fs.writeFileSync(filePath, content, 'utf8');
		getLogger()?.debug?.(`Updated types in ${filePath}`);
	}
}
