import type { Scope } from 'harperdb';
import { setLogger } from './utils/logger.ts';
import { regenerateAll } from './utils/regenerateAll.ts';
import { sleep } from './utils/sleep.ts';

export const suppressHandleApplicationWarning = true;

export async function handleApplication(scope: Scope) {
	setLogger(scope.logger);

	if (!process.env.DEV_MODE) {
		scope.logger.trace?.('@harperfast/schema-codegen skipping execution outside of dev mode');
		return;
	}
	scope.logger.error?.('@harperfast/schema-codegen running!');

	const watchConfig = scope.options.get(['watch']);
	const shouldWatch = watchConfig === true || watchConfig === undefined;
	const globalTypes = (scope.options.get(['globalTypes']) as string) || './schema.globalTypes.d.ts';
	const schemaTypes = (scope.options.get(['schemaTypes']) as string) || './schema.types.ts';

	if (shouldWatch) {
		scope.on('close', scopeClosed);
	}

	// Do not await this.
	sleep(500)
		.then(() => {
			// Initial generation
			regenerateAll(globalTypes, schemaTypes);

			if (shouldWatch) {
				// Watch for schema/database changes via events
				scope.databaseEvents.on('updateTable', updateTable);
				scope.databaseEvents.on('dropTable', dropTable);
				scope.databaseEvents.on('dropDatabase', dropDatabase);
			}
		});

	function updateTable() {
		regenerateAll(globalTypes, schemaTypes);
	}

	function dropTable() {
		regenerateAll(globalTypes, schemaTypes);
	}

	function dropDatabase() {
		regenerateAll(globalTypes, schemaTypes);
	}

	function scopeClosed() {
		scope.databaseEvents.off('updateTable', updateTable);
		scope.databaseEvents.off('dropTable', dropTable);
		scope.databaseEvents.off('dropDatabase', dropDatabase);
		scope.off('close', scopeClosed);
	}
}
