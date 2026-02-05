export interface Logger {
	notify: (...args: any[]) => void;
	fatal: (...args: any[]) => void;
	error: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	info: (...args: any[]) => void;
	debug: (...args: any[]) => void;
	trace: (...args: any[]) => void;
}

let logger: Logger | null = null;

export function setLogger(newLogger: Logger) {
	logger = newLogger;
}

export function getLogger(): Logger {
	return logger!;
}
