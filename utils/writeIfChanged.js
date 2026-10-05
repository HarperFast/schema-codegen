import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from './logger.js';

/**
 * Replaces a file's content through a sibling temporary file and a rename, so a failed write
 * (a full disk, an interrupted process) leaves the previous file intact rather than truncated.
 * @param {string} filePath
 * @param {string} content
 */
export function writeFileAtomic(filePath, content) {
	const temporaryPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		fs.writeFileSync(temporaryPath, content, 'utf8');
		fs.renameSync(temporaryPath, filePath);
	} catch (error) {
		fs.rmSync(temporaryPath, { force: true });
		throw error;
	}
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean} whether the file was written
 */
export function writeIfChanged(filePath, content) {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
	if (existing === content) return false;
	writeFileAtomic(filePath, content);
	getLogger()?.debug?.(`Updated types in ${filePath}`);
	return true;
}
