import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
	findStaleGeneratedFiles,
	publishClientOutputs,
	renderClientOutputs,
} from './clientOutputs.js';
import { diffSchemaIR } from './diffSchemaIR.js';
import { GENERATOR } from './generator.js';
import { assertSchemaIR } from './validateSchemaIR.js';

const USAGE = `Usage:
  schema-codegen generate-client --ir <file> [--swift <dir>] [--swift-module <name>]
                                 [--kotlin <dir>] [--kotlin-package <name>]
  schema-codegen diff <from-ir> <to-ir> [--json] [--fail-on read,write,storage]

generate-client  Writes a Swift package and/or Kotlin module from a schema IR file.
diff             Compares two schema IR files; exits 1 when the change breaks an axis in --fail-on.
`;

const AXES = ['read', 'write', 'storage'];

/**
 * @typedef {Object} CliIO
 * @property {(text: string) => void} stdout
 * @property {(text: string) => void} stderr
 * @property {string} cwd
 */

/**
 * Runs the CLI; returns the exit code (0 success, 1 breaking diff, 2 usage or input error).
 * @param {string[]} argv the arguments after the executable and script
 * @param {CliIO} io
 * @returns {number}
 */
export function runCli(argv, io) {
	const [command, ...rest] = argv;
	try {
		switch (command) {
			case 'generate-client':
				return generateClient(rest, io);
			case 'diff':
				return diff(rest, io);
			case '--version':
			case '-v':
				io.stdout(`${GENERATOR}\n`);
				return 0;
			case undefined:
			case '--help':
			case '-h':
				io.stdout(USAGE);
				return command === undefined ? 2 : 0;
			default:
				io.stderr(`schema-codegen: unknown command "${command}"\n${USAGE}`);
				return 2;
		}
	} catch (error) {
		io.stderr(`schema-codegen: ${/** @type {Error} */ (error).message}\n`);
		return 2;
	}
}

/**
 * @param {string[]} args
 * @param {CliIO} io
 * @returns {number}
 */
function generateClient(args, io) {
	const { values } = parseArgs({
		args,
		options: {
			ir: { type: 'string' },
			swift: { type: 'string' },
			'swift-module': { type: 'string' },
			kotlin: { type: 'string' },
			'kotlin-package': { type: 'string' },
		},
		strict: true,
	});
	if (!values.ir) throw new Error('generate-client needs --ir <file>');
	if (!values.swift && !values.kotlin)
		throw new Error('generate-client needs --swift <dir> and/or --kotlin <dir>');
	const ir = readIR(path.resolve(io.cwd, values.ir));
	const options = {
		baseDirectory: io.cwd,
		swift: values.swift,
		swiftModule: values['swift-module'],
		kotlin: values.kotlin,
		kotlinPackage: values['kotlin-package'],
	};
	const outputs = renderClientOutputs(ir, options);
	const { written, createdScaffolds } = publishClientOutputs(outputs);
	for (const file of [...createdScaffolds, ...written])
		io.stdout(`wrote ${path.relative(io.cwd, file)}\n`);
	if (written.length + createdScaffolds.length === 0) io.stdout('generated files are up to date\n');
	for (const directory of [options.swift, options.kotlin]) {
		if (!directory) continue;
		for (const stale of findStaleGeneratedFiles(path.resolve(io.cwd, directory), outputs)) {
			io.stderr(
				`warning: ${path.relative(io.cwd, stale)} was generated for a different module or package and is no longer updated\n`,
			);
		}
	}
	return 0;
}

/**
 * @param {string[]} args
 * @param {CliIO} io
 * @returns {number}
 */
function diff(args, io) {
	const { values, positionals } = parseArgs({
		args,
		options: { json: { type: 'boolean' }, 'fail-on': { type: 'string' } },
		allowPositionals: true,
		strict: true,
	});
	if (positionals.length !== 2) throw new Error('diff needs two schema IR files');
	const failOn = (values['fail-on'] ?? AXES.join(','))
		.split(',')
		.map((axis) => axis.trim())
		.filter(Boolean);
	const unknown = failOn.filter((axis) => !AXES.includes(axis));
	if (unknown.length > 0)
		throw new Error(`--fail-on accepts ${AXES.join(', ')}; got ${unknown.join(', ')}`);

	const from = readIR(path.resolve(io.cwd, positionals[0]));
	const to = readIR(path.resolve(io.cwd, positionals[1]));
	const result = diffSchemaIR(from, to);
	if (values.json) {
		io.stdout(`${JSON.stringify(result, null, '\t')}\n`);
	} else {
		const { read, write, storage } = result.compatibility;
		io.stdout(`read: ${read}, write: ${write}, storage: ${storage}\n`);
		for (const change of result.changes) {
			io.stdout(
				`  ${change.breaks.length > 0 ? `breaks ${change.breaks.join('+')}` : 'additive'}: ${change.message}\n`,
			);
		}
		for (const rename of result.source)
			io.stdout(`  type renamed: ${rename.from} -> ${rename.to}\n`);
		for (const profile of result.profiles)
			io.stdout(`  profile ${profile.kind}: ${profile.name}\n`);
	}
	const breaking = failOn.some(
		(axis) =>
			result.compatibility[/** @type {'read' | 'write' | 'storage'} */ (axis)] === 'breaking',
	);
	return breaking ? 1 : 0;
}

/**
 * @param {string} filePath
 * @returns {import('./irTypes.js').SchemaIR}
 */
function readIR(filePath) {
	let ir;
	try {
		ir = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (error) {
		throw new Error(`cannot read schema IR ${filePath}: ${/** @type {Error} */ (error).message}`, {
			cause: error,
		});
	}
	assertSchemaIR(ir);
	return ir;
}
