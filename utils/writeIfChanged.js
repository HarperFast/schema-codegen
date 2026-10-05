import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from './logger.js';

/** What Windows reports when renaming over a file another process holds open. */
const LOCKED_TARGET_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * @typedef {Object} StagedFile
 * @property {string} target the file the staged content replaces, symlinks resolved
 * @property {string} temporaryPath
 * @property {string} content
 */

/**
 * Writes content to a temporary file beside the file it will replace, so a failed write (a full
 * disk, an interrupted process) leaves the previous file intact. A symlinked target is resolved,
 * so committing updates the link's target rather than replacing the link.
 * @param {string} filePath
 * @param {string} content
 * @returns {StagedFile}
 */
export function stageFile(filePath, content) {
	const target = resolveTarget(filePath);
	const temporaryPath = path.join(
		path.dirname(target),
		`.${path.basename(target)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		fs.writeFileSync(temporaryPath, content, 'utf8');
	} catch (error) {
		fs.rmSync(temporaryPath, { force: true });
		throw error;
	}
	return { target, temporaryPath, content };
}

/**
 * Moves a staged file into place. A target another process holds open cannot be renamed over on
 * Windows, so it is overwritten in place instead.
 * @param {StagedFile} staged
 */
export function commitStaged(staged) {
	try {
		fs.renameSync(staged.temporaryPath, staged.target);
	} catch (error) {
		try {
			if (!LOCKED_TARGET_CODES.has(/** @type {NodeJS.ErrnoException} */ (error).code ?? ''))
				throw error;
			fs.writeFileSync(staged.target, staged.content, 'utf8');
		} finally {
			discardStaged(staged);
		}
	}
}

/**
 * @param {StagedFile} staged
 */
export function discardStaged(staged) {
	fs.rmSync(staged.temporaryPath, { force: true });
}

/**
 * @param {string} filePath
 * @param {string} content
 */
export function writeFileAtomic(filePath, content) {
	commitStaged(stageFile(filePath, content));
}

/**
 * @param {string} filePath
 * @returns {string | undefined}
 */
export function readIfExists(filePath) {
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
}

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {boolean} whether the file was written
 */
export function writeIfChanged(filePath, content) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	if (readIfExists(filePath) === content) return false;
	writeFileAtomic(filePath, content);
	getLogger()?.debug?.(`Updated types in ${filePath}`);
	return true;
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function resolveTarget(filePath) {
	try {
		return fs.realpathSync(filePath);
	} catch {
		return filePath;
	}
}
