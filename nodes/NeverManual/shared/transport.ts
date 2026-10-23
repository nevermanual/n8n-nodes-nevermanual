import { createHash } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';

export const CREDENTIALS_TYPE = 'neverManualApi';
export const DEFAULT_BASE_URL = 'https://api.nevermanual.cloud';

/** How many times a call refused with 429 is sent again, and the longest Retry-After waited for. */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_MAX_WAIT_SECONDS = 60;

type Context = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export interface ApiRequestOptions {
	qs?: IDataObject;
	body?: IDataObject | Buffer;
	headers?: Record<string, string>;
	itemIndex?: number;
	/** Statuses given back as the answer instead of thrown (the trigger's DELETE treats 404 as done). */
	allowStatus?: number[];
}

export interface ApiFullResponse {
	statusCode: number;
	body: unknown;
}

/** The API's error shape: `{ error: { code, message, details? } }`. */
interface ApiErrorBody {
	error?: { code?: unknown; message?: unknown; details?: unknown };
}

function compactQuery(qs: IDataObject | undefined): IDataObject | undefined {
	if (!qs) return undefined;
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(qs)) {
		if (value === undefined || value === null || value === '') continue;
		out[key] = value;
	}
	return out;
}

function headerValue(headers: IDataObject | undefined, name: string): string | undefined {
	if (!headers) return undefined;
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return Array.isArray(value) ? String(value[0]) : String(value);
	}
	return undefined;
}

/** An API answer of 400 or more as the error n8n shows: the API's message, its code and details. */
export function apiError(
	node: INode,
	statusCode: number,
	body: unknown,
	itemIndex?: number,
): NodeApiError {
	const err =
		body && typeof body === 'object' && 'error' in body ? (body as ApiErrorBody).error : undefined;
	const code = typeof err?.code === 'string' ? err.code : `http_${statusCode}`;
	let message = `The Never Manual API answered ${statusCode}`;
	if (typeof err?.message === 'string' && err.message) message = err.message;
	else if (typeof body === 'string' && body.trim()) message = body.trim().slice(0, 300);
	const parts = [`Code: ${code}`];
	if (err?.details !== undefined) parts.push(`Details: ${JSON.stringify(err.details)}`);
	const response: JsonObject = { code, message, httpCode: String(statusCode) };
	if (err?.details !== undefined) response.details = err.details as JsonObject;
	const error = new NodeApiError(node, response, {
		message,
		description: parts.join('. '),
		httpCode: String(statusCode),
		itemIndex,
	});
	error.context.apiCode = code;
	return error;
}

/** Any error as one n8n shows with its item: ours as they are, others as an operation error. */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (error.context.itemIndex === undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(node, error as Error, { itemIndex });
}

async function send(
	this: Context,
	options: IHttpRequestOptions,
	itemIndex: number | undefined,
): Promise<IN8nHttpFullResponse> {
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIALS_TYPE,
			options,
		)) as IN8nHttpFullResponse;
	} catch (error) {
		// no answer at all: the address is wrong, the network is down, or it timed out
		throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
	}
}

/** One call to the API, its answer as the full response; 429 is waited out and sent again. */
export async function apiRequestFull(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: ApiRequestOptions = {},
): Promise<ApiFullResponse> {
	const credentials = await this.getCredentials(CREDENTIALS_TYPE);
	const base = String(credentials.baseUrl || DEFAULT_BASE_URL)
		.trim()
		.replace(/\/+$/, '');
	const request: IHttpRequestOptions = {
		method,
		url: `${base}${path}`,
		qs: compactQuery(options.qs),
		headers: { Accept: 'application/json', ...options.headers },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (options.body !== undefined) request.body = options.body;

	for (let attempt = 0; ; attempt++) {
		const response = await send.call(this, request, options.itemIndex);
		const status = response.statusCode;
		if (status === 429 && attempt < RATE_LIMIT_RETRIES) {
			const wait = Number(headerValue(response.headers, 'retry-after') ?? '5');
			if (Number.isFinite(wait) && wait >= 0 && wait <= RATE_LIMIT_MAX_WAIT_SECONDS) {
				await sleep(Math.max(1, wait) * 1000);
				continue;
			}
		}
		if (status >= 400 && !options.allowStatus?.includes(status)) {
			throw apiError(this.getNode(), status, response.body, options.itemIndex);
		}
		return { statusCode: status, body: response.body };
	}
}

/** One call to the API, its JSON answer. */
export async function apiRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	options: ApiRequestOptions = {},
): Promise<IDataObject> {
	const response = await apiRequestFull.call(this, method, path, options);
	return (response.body ?? {}) as IDataObject;
}

interface CursorPage {
	data?: IDataObject[];
	next_cursor?: string | null;
}

/** A list read page by page through `next_cursor` (Media, Slate posts), up to `limit` unless all are asked for. */
export async function apiRequestCursorPages(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
	itemIndex: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const size = returnAll ? 100 : Math.min(100, Math.max(1, limit - out.length));
		const page = (await apiRequest.call(this, 'GET', path, {
			qs: { ...qs, limit: size, cursor },
			itemIndex,
		})) as CursorPage;
		out.push(...(page.data ?? []));
		cursor = page.next_cursor ?? undefined;
	} while (cursor && (returnAll || out.length < limit));
	return returnAll ? out : out.slice(0, limit);
}

interface OffsetPage {
	data?: IDataObject[];
	total?: number;
}

/** A list read page by page through `offset` and `total` (Studio runs). */
export async function apiRequestOffsetPages(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
	itemIndex: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let offset = 0;
	for (;;) {
		const size = returnAll ? 100 : Math.min(100, Math.max(1, limit - out.length));
		const page = (await apiRequest.call(this, 'GET', path, {
			qs: { ...qs, limit: size, offset },
			itemIndex,
		})) as OffsetPage;
		const rows = page.data ?? [];
		out.push(...rows);
		offset += rows.length;
		if (!rows.length || offset >= (page.total ?? 0)) break;
		if (!returnAll && out.length >= limit) break;
	}
	return returnAll ? out : out.slice(0, limit);
}

/** A path segment for an id that may hold slashes (`user/my-flow`): each part encoded, the slashes kept. */
export function encodeIdPath(id: string): string {
	return id
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
}

/**
 * An Idempotency-Key for a call that makes something: the same execution, node, node run, item and request give
 * the same key, so n8n's Retry On Fail gets the run, post or file it already made instead of a second one. The
 * request's own fingerprint is part of it: a retry whose expressions now give other values is another request.
 */
export function idempotencyKey(
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
	request: IDataObject | Array<string | Buffer>,
): string | undefined {
	const executionId = this.getExecutionId();
	if (!executionId) return undefined;
	let runIndex = 0;
	try {
		runIndex = Number(this.getWorkflowDataProxy(itemIndex).$thisRunIndex ?? 0) || 0;
	} catch {
		runIndex = 0;
	}
	const node = this.getNode();
	const hash = createHash('sha256');
	if (Array.isArray(request)) for (const part of request) hash.update(part);
	else hash.update(JSON.stringify(request));
	const fingerprint = hash.digest('hex').slice(0, 16);
	return `n8n:${executionId}:${node.id ?? node.name}:${runIndex}:${itemIndex}:${operation}:${fingerprint}`.slice(
		0,
		255,
	);
}
