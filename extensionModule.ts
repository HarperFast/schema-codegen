import fs from 'fs';
import type { Scope } from 'harperdb';
import path from 'path';
import { generateTablesDTS } from './utils/generateTablesDTS.ts';
import { getLogger, setLogger } from './utils/logger.ts';
import { processDirectory } from './utils/processDirectory.ts';
import { processFile } from './utils/processFile.ts';

export const suppressHandleApplicationWarning = true;

export async function handleApplication(scope: Scope) {
	// TODO: Look at scope, er, config? to figure out schemas.
	// TODO: Use the scope for file change detection. Should we use our files config like other applications?
	// TODO: Determine if we are in dev mode and should watch for changes?
	// TODO: Allow turning off watching via config.
	setLogger(scope.logger);
	const watchedDir = './';
	const allTables = new Map();

	allTables.clear();
	processDirectory(watchedDir, allTables);
	generateTablesDTS(watchedDir, allTables);

	getLogger().debug(`Watching ${watchedDir} for .graphql changes...`);
	fs.watch(watchedDir, { recursive: true }, (_eventType, filename) => {
		if (filename && !filename.includes('node_modules') && filename?.endsWith('.graphql')) {
			const fullPath = path.join(watchedDir, filename);
			if (fs.existsSync(fullPath)) {
				processFile(fullPath, allTables);
				generateTablesDTS(watchedDir, allTables);
			} else {
				const tsPath = fullPath + '.ts';
				if (fs.existsSync(tsPath)) {
					getLogger().debug(`Removing types for deleted file ${fullPath}...`);
					fs.unlinkSync(tsPath);
					allTables.delete(fullPath);
					generateTablesDTS(watchedDir, allTables);
				}
			}
		}
	});
}
