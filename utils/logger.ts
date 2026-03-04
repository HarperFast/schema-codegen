import type { Logger } from 'harperdb';

let logger: Logger | null = null;

export function setLogger(newLogger: Logger) {
	logger = newLogger;
}

export function getLogger(): Logger {
	return logger!;
}
