/** @import { SchemaIR } from './irTypes.js' */
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, writeIfChanged } from '../writeIfChanged.js';
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
 * Renders every requested output in memory: the Swift package, the Kotlin module, and the IR file
 * last (it is the baseline the next run diffs against, so it is published after the sources).
 * Nothing is written; invalid options throw before any output exists.
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
 * Writes rendered outputs in order. Generated files are replaced atomically when their content
 * changed; scaffolds are created only when absent and never touched again.
 * @param {ClientOutput[]} outputs
 * @returns {{ written: string[], createdScaffolds: string[] }}
 */
export function publishClientOutputs(outputs) {
	/** @type {string[]} */
	const written = [];
	/** @type {string[]} */
	const createdScaffolds = [];
	for (const output of outputs) {
		if (output.scaffold) {
			if (fs.existsSync(output.path)) continue;
			fs.mkdirSync(path.dirname(output.path), { recursive: true });
			writeFileAtomic(output.path, output.content);
			createdScaffolds.push(output.path);
		} else if (writeIfChanged(output.path, output.content)) {
			written.push(output.path);
		}
	}
	return { written, createdScaffolds };
}

/**
 * Generated sources under a package directory that the current outputs do not include, such as
 * those left behind by a renamed Swift module or Kotlin package. They are reported, never deleted.
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
