import { randomBytes } from 'node:crypto';
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { returnAllAndLimit } from '../shared/descriptions';
import { apiRequest, apiRequestCursorPages, idempotencyKey } from '../shared/transport';

const show = { resource: ['media'] };
const upload = { ...show, operation: ['upload'] };

export const mediaDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Get a file with fresh links',
				action: 'Get a file',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List the workspace's files, newest first",
				action: 'Get many files',
			},
			{
				name: 'Upload',
				value: 'upload',
				description: "Add a file to the workspace's Media, from the input or by link",
				action: 'Upload a file',
			},
		],
		default: 'upload',
	},

	// --- upload ---
	{
		displayName: 'Source',
		name: 'source',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: upload },
		options: [
			{
				name: 'Binary File',
				value: 'binary',
				description: 'A file from the input item, at most 100 MB',
			},
			{
				name: 'URL',
				value: 'url',
				description:
					'A link the file is fetched from, up to 2 GB; Google Drive and Dropbox share links work',
			},
		],
		default: 'binary',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to be uploaded',
		displayOptions: { show: { ...upload, source: ['binary'] } },
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://drive.google.com/file/d/.../view',
		description: 'The http(s) link to fetch the file from',
		displayOptions: { show: { ...upload, source: ['url'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: upload },
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: "The file's name in Media. Leave empty to keep the file's own.",
			},
			{
				displayName: 'Tags',
				name: 'tags',
				type: 'string',
				default: '',
				placeholder: 'e.g. n8n, drafts',
				description: 'Tags for the file, separated by commas',
			},
		],
	},

	// --- get ---
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		description: "The file's ID in Media",
		displayOptions: { show: { ...show, operation: ['get'] } },
	},

	// --- get many ---
	...returnAllAndLimit({ ...show, operation: ['getAll'] }),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { ...show, operation: ['getAll'] } },
		options: [
			{
				displayName: 'Added After',
				name: 'since',
				type: 'dateTime',
				default: '',
				description: 'Only files added after this moment',
			},
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				options: [
					{ name: 'Image', value: 'image' },
					{ name: 'Video', value: 'video' },
				],
				default: 'image',
			},
			{
				displayName: 'Name Contains',
				name: 'q',
				type: 'string',
				default: '',
				description: 'Words in the name',
			},
			{
				displayName: 'Tag',
				name: 'tag',
				type: 'string',
				default: '',
				description: 'Only files with this tag',
			},
		],
	},
];

const tagList = (raw: unknown): string[] =>
	String(raw ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

/** A multipart/form-data body by hand: the fields first (the API reads those before the file), then the file. */
function multipartBody(
	fields: Array<[string, string]>,
	file: { data: Buffer; fileName: string; mimeType: string },
): { body: Buffer; contentType: string } {
	const boundary = `----NeverManualN8n${randomBytes(12).toString('hex')}`;
	const quote = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/"/g, '%22');
	const chunks: Buffer[] = [];
	for (const [name, value] of fields) {
		chunks.push(
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`,
				'utf8',
			),
		);
	}
	chunks.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quote(file.fileName)}"\r\nContent-Type: ${quote(file.mimeType)}\r\n\r\n`,
			'utf8',
		),
	);
	chunks.push(file.data);
	chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
	return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function executeMedia(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'upload') {
		const source = this.getNodeParameter('source', i) as string;
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const name = typeof options.name === 'string' ? options.name.trim() : '';
		const tags = tagList(options.tags);
		if (source === 'url') {
			const url = String(this.getNodeParameter('url', i)).trim();
			if (!/^https?:\/\//i.test(url)) {
				throw new NodeOperationError(
					this.getNode(),
					'The URL must start with http:// or https://',
					{
						itemIndex: i,
					},
				);
			}
			const body: IDataObject = { url };
			if (name) body.name = name;
			if (tags.length) body.tags = tags;
			const key = idempotencyKey.call(this, 'media-upload', i, body);
			return await apiRequest.call(this, 'POST', '/v1/media', {
				body,
				headers: key ? { 'Idempotency-Key': key } : undefined,
				itemIndex: i,
			});
		}
		const field = this.getNodeParameter('binaryPropertyName', i) as string;
		const binary = this.helpers.assertBinaryData(i, field);
		const data = await this.helpers.getBinaryDataBuffer(i, field);
		const fields: Array<[string, string]> = [];
		if (name) fields.push(['name', name]);
		if (tags.length) fields.push(['tags', tags.join(',')]);
		const form = multipartBody(fields, {
			data,
			fileName: binary.fileName || name || 'file',
			mimeType: binary.mimeType || 'application/octet-stream',
		});
		// the multipart boundary is new each time: the key is made from the file and the fields instead
		const key = idempotencyKey.call(this, 'media-upload', i, [JSON.stringify(fields), data]);
		const headers: Record<string, string> = { 'Content-Type': form.contentType };
		if (key) headers['Idempotency-Key'] = key;
		return await apiRequest.call(this, 'POST', '/v1/media', {
			body: form.body,
			headers,
			itemIndex: i,
		});
	}
	if (operation === 'get') {
		const id = String(this.getNodeParameter('mediaId', i)).trim();
		if (!/^\d+$/.test(id)) {
			throw new NodeOperationError(this.getNode(), 'A Media ID is a number', { itemIndex: i });
		}
		return await apiRequest.call(this, 'GET', `/v1/media/${id}`, { itemIndex: i });
	}
	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		let since = filters.since;
		if (typeof since === 'string' && since) {
			const t = new Date(since);
			if (!Number.isNaN(t.getTime())) since = t.toISOString();
		}
		return await apiRequestCursorPages.call(
			this,
			'/v1/media',
			{ kind: filters.kind, q: filters.q, tag: filters.tag, since },
			this.getNodeParameter('returnAll', i) as boolean,
			this.getNodeParameter('limit', i, 50) as number,
			i,
		);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
