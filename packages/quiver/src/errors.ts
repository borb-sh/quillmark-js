export type QuiverErrorCode =
	'invalid_ref' | 'quill_not_found' | 'quiver_invalid' | 'transport_error';

export class QuiverError extends Error {
	readonly code: QuiverErrorCode;
	/** Offending ref string, when available. */
	readonly ref?: string;
	/** Offending version, when available. */
	readonly version?: string;
	/** Quiver `name` from Quiver.yaml, when available. */
	readonly quiverName?: string;

	constructor(
		code: QuiverErrorCode,
		message: string,
		options?: {
			ref?: string;
			version?: string;
			quiverName?: string;
			cause?: unknown;
		}
	) {
		super(message, { cause: options?.cause });
		this.name = 'QuiverError';
		this.code = code;
		this.ref = options?.ref;
		this.version = options?.version;
		this.quiverName = options?.quiverName;
	}
}

/** Run `io`, rethrowing its failure as a `transport_error` whose message names what failed. A `QuiverError` passes through untouched. */
export async function transport<T>(failed: string, io: () => Promise<T>): Promise<T> {
	try {
		return await io();
	} catch (err) {
		if (err instanceof QuiverError) throw err;
		throw new QuiverError('transport_error', `${failed}: ${(err as Error).message}`, {
			cause: err
		});
	}
}
