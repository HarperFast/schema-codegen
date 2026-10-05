/** @import { SchemaIR } from './irTypes.js' */
/** @import { StagedFile } from '../writeIfChanged.js' */
import fs from 'node:fs';
import path from 'node:path';
import { commitStaged, discardStaged, readIfExists, stageFile } from '../writeIfChanged.js';
import { GENERATED_MARKER } from './emitSupport.js';
import { emitKotlinModule } from './emitKotlin.js';
import { emitSwiftPackage } from './emitSwift.js';

/**
 * Where client outputs go. Relative paths resolve against `baseDirectory`.
 * @typedef {Object} ClientOutputOptions
 * @property {string} [baseDirectory]
 * @property {string} [schemaIR] the IR JSON file
 * @property {string} [swift] the Swift package directory
 * @property {string} [swiftModule]
 * @property {string} [kotlin] the Kotlin module directory
 * @property {string} [kotlinPackage]
 */

/**
 * @typedef {Object} ClientOutput
 * @property {string} path absolute
 * @property {string} content
 * @property {boolean} scaffold written only when absent
 * @property {'swift' | 'kotlin' | 'ir'} target
 */

/**
 * @param {SchemaIR} ir
 * @returns {string}
 */
export function serializeSchemaIR(ir) {
	return `${JSON.stringify(ir, null, '\t')}\n`;
}

/**
 * Renders every requested output in memory, the IR file last: it is the baseline the next run
 * diffs against, so it must never be published ahead of the sources generated from it.
 * @param {SchemaIR} ir
 * @param {ClientOutputOptions} options
 * @returns {ClientOutput[]}
 */
export function renderClientOutputs(ir, options) {
	const base = options.baseDirectory ?? '';
	/** @type {ClientOutput[]} */
	const outputs = [];
	if (options.swift) {
		const directory = path.resolve(base, options.swift);
		for (const file of emitSwiftPackage(ir, { module: options.swiftModule })) {
			outputs.push({
				path: path.join(directory, ...file.path.split('/')),
				content: file.content,
				scaffold: file.scaffold,
				target: 'swift',
			});
		}
	}
	if (options.kotlin) {
		const directory = path.resolve(base, options.kotlin);
		for (const file of emitKotlinModule(ir, { packageName: options.kotlinPackage })) {
			outputs.push({
				path: path.join(directory, ...file.path.split('/')),
				content: file.content,
				scaffold: file.scaffold,
				target: 'kotlin',
			});
		}
	}
	if (options.schemaIR) {
		outputs.push({
			path: path.resolve(base, options.schemaIR),
			content: serializeSchemaIR(ir),
			scaffold: false,
			target: 'ir',
		});
	}
	return outputs;
}

/**
 * Publishes changed outputs, and scaffolds that do not exist yet, as one generation: every file is
 * staged beside its target before any is moved into place, in order, so a failed write (a full
 * disk) publishes nothing.
 * @param {ClientOutput[]} outputs
 * @returns {{ written: string[], createdScaffolds: string[] }}
 */
export function publishClientOutputs(outputs) {
	/** @type {{ output: ClientOutput, staged: StagedFile }[]} */
	const pending = [];
	try {
		for (const output of outputs) {
			const unchanged = output.scaffold
				? fs.existsSync(output.path)
				: readIfExists(output.path) === output.content;
			if (unchanged) continue;
			fs.mkdirSync(path.dirname(output.path), { recursive: true });
			pending.push({ output, staged: stageFile(output.path, output.content) });
		}
	} catch (error) {
		for (const { staged } of pending) discardStaged(staged);
		throw error;
	}
	/** @type {string[]} */
	const written = [];
	/** @type {string[]} */
	const createdScaffolds = [];
	pending.forEach(({ output, staged }, index) => {
		try {
			commitStaged(staged);
		} catch (error) {
			for (const rest of pending.slice(index + 1)) discardStaged(rest.staged);
			throw error;
		}
		(output.scaffold ? createdScaffolds : written).push(output.path);
	});
	return { written, createdScaffolds };
}

/**
 * Generated sources a renamed Swift module or Kotlin package left behind: reported, never deleted.
 * @param {string} directory a package directory
 * @param {ClientOutput[]} outputs
 * @returns {string[]}
 */
export function findStaleGeneratedFiles(directory, outputs) {
	const current = new Set(outputs.map((output) => output.path));
	/** @type {string[]} */
	const stale = [];
	/**
	 * @param {string} folder
	 * @param {number} depth
	 */
	const walk = (folder, depth) => {
		if (depth > 16 || !fs.existsSync(folder)) return;
		for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
			const entryPath = path.join(folder, entry.name);
			if (entry.isDirectory()) {
				walk(entryPath, depth + 1);
			} else if (
				entry.isFile() &&
				/\.(swift|kt)$/.test(entry.name) &&
				!current.has(entryPath) &&
				isGenerated(entryPath)
			) {
				stale.push(entryPath);
			}
		}
	};
	walk(directory, 0);
	return stale.sort();
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isGenerated(filePath) {
	const handle = fs.openSync(filePath, 'r');
	try {
		const buffer = Buffer.alloc(GENERATED_MARKER.length);
		const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
		return buffer.toString('utf8', 0, bytesRead) === GENERATED_MARKER;
	} finally {
		fs.closeSync(handle);
	}
}
