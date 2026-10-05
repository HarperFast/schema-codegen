/** @import { SchemaIR } from './irTypes.js' */
/** @import { SourceTable, SourceTypeDef } from './buildSchemaIR.js' */
/** @import { ClientOutputOptions } from './clientOutputs.js' */
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../logger.js';
import { buildSchemaIR } from './buildSchemaIR.js';
import {
	findStaleGeneratedFiles,
	publishClientOutputs,
	renderClientOutputs,
} from './clientOutputs.js';
import { diffSchemaIR } from './diffSchemaIR.js';
import { GENERATOR } from './generator.js';
import { loadSyncProfilesFile } from './syncProfiles.js';
import { assertSchemaIR } from './validateSchemaIR.js';

/**
 * @typedef {ClientOutputOptions & {
 *   syncProfiles?: string,
 *   types?: Map<string, SourceTypeDef> | Record<string, SourceTypeDef>,
 * }} RegenerateClientOptions
 */

/**
 * Builds the IR from the given tables and publishes the configured client outputs, reporting
 * profile diagnostics, compatibility with the previously published IR, and stale generated files.
 * @param {SourceTable[]} tables already database-filtered
 * @param {RegenerateClientOptions} options
 * @returns {Promise<SchemaIR>}
 */
export async function regenerateClient(tables, options) {
	const logger = getLogger();
	const base = options.baseDirectory ?? '';
	const irPath = options.schemaIR ? path.resolve(base, options.schemaIR) : undefined;
	const previous = irPath ? readPublishedIR(irPath) : undefined;

	let syncProfiles;
	if (options.syncProfiles) {
		const profilesPath = path.resolve(base, options.syncProfiles);
		syncProfiles = await loadSyncProfilesFile(profilesPath);
		if (syncProfiles === undefined) {
			logger?.warn?.(
				`@harperfast/schema-codegen: sync profiles file ${profilesPath} does not exist; no profiles are generated`,
			);
		}
	}

	const ir = buildSchemaIR({
		tables,
		types: options.types,
		syncProfiles,
		previous,
		generator: GENERATOR,
	});
	for (const diagnostic of ir.diagnostics) {
		const message = `@harperfast/schema-codegen: ${diagnostic.message}`;
		if (diagnostic.level === 'error') logger?.error?.(message);
		else logger?.warn?.(message);
	}
	if (previous && previous.schemaHash !== ir.schemaHash) {
		const diff = diffSchemaIR(previous, ir);
		const breaking = /** @type {const} */ (['read', 'write', 'storage']).filter(
			(axis) => diff.compatibility[axis] === 'breaking',
		);
		if (breaking.length > 0) {
			const changes = diff.changes
				.filter((change) => change.breaks.length > 0)
				.map((change) => `${change.message} (breaks ${change.breaks.join(', ')})`);
			logger?.warn?.(
				`@harperfast/schema-codegen: this schema change breaks ${breaking.join(', ')} compatibility for clients generated before it:\n  ${changes.join('\n  ')}`,
			);
		}
		for (const rename of diff.source) {
			logger?.warn?.(
				`@harperfast/schema-codegen: generated type ${rename.from} is now ${rename.to}`,
			);
		}
	}

	const outputs = renderClientOutputs(ir, options);
	const swiftManifest = options.swift
		? path.resolve(base, options.swift, 'Package.swift')
		: undefined;
	const manifestExisted = swiftManifest !== undefined && fs.existsSync(swiftManifest);
	publishClientOutputs(outputs);

	const module = options.swiftModule ?? 'HarperModels';
	if (
		swiftManifest &&
		manifestExisted &&
		!fs.readFileSync(swiftManifest, 'utf8').includes(`"${module}"`)
	) {
		logger?.warn?.(
			`@harperfast/schema-codegen: ${swiftManifest} does not declare the "${module}" target the models are generated into`,
		);
	}
	for (const directory of [options.swift, options.kotlin]) {
		if (!directory) continue;
		for (const stale of findStaleGeneratedFiles(path.resolve(base, directory), outputs)) {
			logger?.warn?.(
				`@harperfast/schema-codegen: ${stale} was generated for a different module or package and is no longer updated`,
			);
		}
	}
	return ir;
}

/**
 * The previously published IR, when it is still readable by this generator.
 * @param {string} irPath
 * @returns {SchemaIR | undefined}
 */
function readPublishedIR(irPath) {
	if (!fs.existsSync(irPath)) return undefined;
	try {
		const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
		assertSchemaIR(ir);
		return ir;
	} catch (error) {
		getLogger()?.warn?.(
			`@harperfast/schema-codegen: ignoring the existing ${irPath} (${/** @type {Error} */ (error).message}); type names may change and compatibility is not checked`,
		);
		return undefined;
	}
}
