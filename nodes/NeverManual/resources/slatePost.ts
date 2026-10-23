import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { returnAllAndLimit, toIdList } from '../shared/descriptions';
import { apiRequest, apiRequestCursorPages, idempotencyKey } from '../shared/transport';

const show = { resource: ['slatePost'] };
const create = { ...show, operation: ['create'] };

export const slatePostDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Create',
				value: 'create',
				description:
					'Post Media files to social accounts: each file becomes a post on each account, into the queue or on a day',
				action: 'Create posts',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a post: its stage, and its link once published',
				action: 'Get a post',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List the workspace's posts, newest first",
				action: 'Get many posts',
			},
		],
		default: 'create',
	},

	// --- create ---
	{
		displayName: 'Account Names or IDs',
		name: 'accounts',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getAccounts' },
		required: true,
		default: [],
		description:
			'The social accounts to post to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: { show: create },
	},
	{
		displayName: 'Media IDs or Links',
		name: 'media',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. 101, 102',
		description:
			'Media IDs or http(s) links (added to Media first), separated by commas, or an expression that gives a list, such as the media_id of each output of a Studio run',
		displayOptions: { show: create },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description:
			'The same text for every post. Leave empty to let each account write its own in its voice.',
		displayOptions: { show: create },
	},
	{
		displayName: 'When',
		name: 'when',
		type: 'options',
		displayOptions: { show: create },
		options: [
			{
				name: 'At a Date and Time',
				value: 'dateTime',
				description: "At this time in the workspace's time zone",
			},
			{
				name: 'Next Free Slot',
				value: 'queue',
				description: "The account's next free slot in the queue",
			},
			{
				name: 'On a Day',
				value: 'day',
				description: "A free slot on this day in the workspace's time zone",
			},
		],
		default: 'queue',
	},
	{
		displayName: 'Date and Time',
		name: 'dateTime',
		type: 'dateTime',
		required: true,
		default: '',
		description:
			"Read as the time in the workspace's time zone: the date and the hours and minutes are kept, any offset is not",
		displayOptions: { show: { ...create, when: ['dateTime'] } },
	},
	{
		displayName: 'Day',
		name: 'day',
		type: 'dateTime',
		required: true,
		default: '',
		description: 'Only the date is used',
		displayOptions: { show: { ...create, when: ['day'] } },
	},
	{
		displayName: 'Kind',
		name: 'kind',
		type: 'options',
		displayOptions: { show: create },
		options: [
			{
				name: 'Carousel',
				value: 'carousel',
				description: 'All the files as one post',
			},
			{
				name: 'Feed',
				value: 'feed',
				description: 'Each file a post of its own',
			},
			{
				name: 'Story',
				value: 'story',
				description: 'Each file a story',
			},
		],
		default: 'feed',
	},
	{
		displayName: 'Hold for Review',
		name: 'hold',
		type: 'boolean',
		default: true,
		description:
			"Whether the posts wait in Slate's queue until a person releases them. Turn off to post without a look.",
		displayOptions: { show: create },
	},

	// --- get ---
	{
		displayName: 'Post ID',
		name: 'postId',
		type: 'string',
		required: true,
		default: '',
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
				displayName: 'Account Name or ID',
				name: 'account',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAccounts' },
				default: '',
				description:
					'Only this account\'s posts. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Stage',
				name: 'stage',
				type: 'options',
				options: [
					{ name: 'Cancelled', value: 'cancelled' },
					{ name: 'Draft', value: 'draft' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Published', value: 'published' },
					{ name: 'Publishing', value: 'publishing' },
					{ name: 'Scheduled', value: 'scheduled' },
					{ name: 'Waiting', value: 'waiting' },
				],
				default: 'published',
			},
		],
	},
];

/** A date-time parameter as text: a string, or a Luxon DateTime an expression gave. */
function dateText(value: unknown): string {
	if (
		value &&
		typeof value === 'object' &&
		typeof (value as { toISO?: unknown }).toISO === 'function'
	) {
		return String((value as { toISO: () => string }).toISO());
	}
	if (value instanceof Date) return value.toISOString();
	return String(value ?? '').trim();
}

function whenOf(this: IExecuteFunctions, i: number): string {
	const mode = this.getNodeParameter('when', i, 'queue') as string;
	if (mode === 'queue') return 'queue';
	const raw = dateText(this.getNodeParameter(mode === 'day' ? 'day' : 'dateTime', i));
	const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(raw);
	if (!m) {
		throw new NodeOperationError(this.getNode(), `Not a date: "${raw}"`, {
			itemIndex: i,
			description: 'Give a date like 2026-10-25, or a date and time like 2026-10-25T14:30',
		});
	}
	if (mode === 'day') return m[1];
	if (!m[2]) {
		throw new NodeOperationError(this.getNode(), `"${raw}" has no time`, { itemIndex: i });
	}
	return `${m[1]} ${m[2]}`;
}

function accountIds(this: IExecuteFunctions, i: number): number[] {
	const raw = this.getNodeParameter('accounts', i, []) as unknown;
	const ids = toIdList(raw).map((v) => (typeof v === 'number' ? v : Number.NaN));
	if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
		throw new NodeOperationError(
			this.getNode(),
			'Pick one or more accounts (account IDs are numbers)',
			{
				itemIndex: i,
			},
		);
	}
	return ids;
}

export async function executeSlatePost(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'create') {
		const media = toIdList(this.getNodeParameter('media', i));
		if (!media.length) {
			throw new NodeOperationError(this.getNode(), 'Give one or more Media IDs or links', {
				itemIndex: i,
			});
		}
		const body: IDataObject = {
			accounts: accountIds.call(this, i),
			media,
			when: whenOf.call(this, i),
			kind: this.getNodeParameter('kind', i, 'feed') as string,
			hold: this.getNodeParameter('hold', i, true) as boolean,
		};
		const text = String(this.getNodeParameter('text', i, '') ?? '');
		if (text.trim()) body.text = text;
		const key = idempotencyKey.call(this, 'slate-posts', i, body);
		const answer = await apiRequest.call(this, 'POST', '/v1/slate/posts', {
			body,
			headers: key ? { 'Idempotency-Key': key } : undefined,
			itemIndex: i,
		});
		// one item per post, each carrying how many were made and how many already were
		const posts = (answer.data as IDataObject[] | undefined) ?? [];
		if (!posts.length) return { data: [], created: answer.created, existing: answer.existing };
		return posts.map((post) => ({ ...post, created: answer.created, existing: answer.existing }));
	}
	if (operation === 'get') {
		const id = String(this.getNodeParameter('postId', i)).trim();
		if (!/^\d+$/.test(id)) {
			throw new NodeOperationError(this.getNode(), 'A post ID is a number', { itemIndex: i });
		}
		return await apiRequest.call(this, 'GET', `/v1/slate/posts/${id}`, { itemIndex: i });
	}
	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await apiRequestCursorPages.call(
			this,
			'/v1/slate/posts',
			{ account: filters.account, stage: filters.stage },
			this.getNodeParameter('returnAll', i) as boolean,
			this.getNodeParameter('limit', i, 50) as number,
			i,
		);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
