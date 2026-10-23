import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { jsonParse, NodeOperationError, sleep } from 'n8n-workflow';
import { returnAllAndLimit, toIdList, workflowLocator } from '../shared/descriptions';
import {
	apiRequest,
	apiRequestOffsetPages,
	encodeIdPath,
	idempotencyKey,
} from '../shared/transport';

const show = { resource: ['studioRun'] };
const start = { ...show, operation: ['start'] };
const FINAL = new Set(['completed', 'failed', 'canceled']);

export const studioRunDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Cancel',
				value: 'cancel',
				description: 'Stop a run that has not ended',
				action: 'Cancel a run',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a run: its status and, once completed, its files',
				action: 'Get a run',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List the workspace's runs, newest first",
				action: 'Get many runs',
			},
			{
				name: 'Start',
				value: 'start',
				description:
					"Start a run of a workflow, paid from the workspace's balance, and optionally wait for its files",
				action: 'Start a run',
			},
		],
		default: 'start',
	},

	// --- start ---
	workflowLocator(start, 'The workflow to run'),
	{
		displayName: 'Specify Inputs',
		name: 'inputSource',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: start },
		options: [
			{ name: 'Using Fields Below', value: 'fields' },
			{ name: 'Using JSON', value: 'json' },
		],
		default: 'fields',
	},
	{
		displayName: 'Inputs',
		name: 'inputs',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Input',
		default: {},
		description:
			'The values the run takes, by the names the workflow gives. Inputs left out use their defaults.',
		displayOptions: { show: { ...start, inputSource: ['fields'] } },
		options: [
			{
				displayName: 'Input',
				name: 'input',
				values: [
					{
						displayName: 'Name or ID',
						name: 'name',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'getWorkflowInputs',
							loadOptionsDependsOn: ['workflowId.value'],
						},
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description:
							'A file input takes a Media ID or an http(s) link (it is added to Media first); a files input takes several, separated by commas; other inputs take text, a number, or true/false',
					},
				],
			},
		],
	},
	{
		displayName: 'Inputs (JSON)',
		name: 'inputsJson',
		type: 'json',
		default: '{}',
		description:
			'An object of input name to value, e.g. {"Face": 101, "Photo": "https://example.com/photo.jpg", "Prompt": "studio light"}',
		displayOptions: { show: { ...start, inputSource: ['json'] } },
	},
	{
		displayName: 'Speed',
		name: 'speed',
		type: 'options',
		displayOptions: { show: start },
		options: [
			{
				name: 'Cheaper',
				value: 'cheaper',
				description: 'Waits for a free place on a card that is already running',
			},
			{
				name: 'Faster',
				value: 'faster',
				description: 'May start a card at once',
			},
			{
				name: 'Standard',
				value: 'standard',
				description: 'Studio decides',
			},
		],
		default: 'standard',
	},
	{
		displayName: 'Wait for Completion',
		name: 'waitForCompletion',
		type: 'boolean',
		default: true,
		description:
			'Whether to wait until the run ends and output the finished run with its files and download links, instead of the queued run',
		displayOptions: { show: start },
	},
	{
		displayName: 'Timeout (Minutes)',
		name: 'timeoutMinutes',
		type: 'number',
		default: 15,
		typeOptions: { minValue: 1, maxValue: 180 },
		description:
			'How long to wait for the run to end. When it runs longer the node fails, and the run keeps going in Studio.',
		displayOptions: { show: { ...start, waitForCompletion: [true] } },
	},
	{
		displayName: 'Check Every (Seconds)',
		name: 'pollSeconds',
		type: 'number',
		default: 5,
		typeOptions: { minValue: 2, maxValue: 60 },
		description: 'How often to read the run while waiting',
		displayOptions: { show: { ...start, waitForCompletion: [true] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: start },
		options: [
			{
				displayName: 'Advanced Settings (JSON)',
				name: 'advanced',
				type: 'json',
				default: '{}',
				description:
					'The graph\'s own settings by Studio\'s keys, e.g. {"n12.seed": 42}, for those who know them',
			},
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/hooks/run-ended',
				description:
					"An address told when this run ends (run.completed, run.failed or run.canceled), signed with the workspace's secret",
			},
		],
	},

	// --- get, cancel ---
	{
		displayName: 'Run ID',
		name: 'runId',
		type: 'string',
		required: true,
		default: '',
		description: 'The ID of the run, as Start gave it',
		displayOptions: { show: { ...show, operation: ['get', 'cancel'] } },
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
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
					{ name: 'Queued', value: 'queued' },
					{ name: 'Running', value: 'running' },
				],
				default: 'completed',
			},
			{
				displayName: 'Workflow Name or ID',
				name: 'workflow',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getWorkflows' },
				default: '',
				description:
					'Only the runs of this workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

interface WorkflowInput {
	name: string;
	type?: string;
}

/** The names of the workflow's inputs that take several files. */
async function filesInputs(
	this: IExecuteFunctions,
	workflow: string,
	i: number,
): Promise<Set<string>> {
	const detail = await apiRequest.call(
		this,
		'GET',
		`/v1/studio/workflows/${encodeIdPath(workflow)}`,
		{
			itemIndex: i,
		},
	);
	const inputs = (detail.inputs as WorkflowInput[] | undefined) ?? [];
	return new Set(inputs.filter((x) => x.type === 'files').map((x) => x.name));
}

function parseObject(this: IExecuteFunctions, raw: unknown, field: string, i: number): IDataObject {
	if (raw === undefined || raw === null || raw === '') return {};
	const value =
		typeof raw === 'string'
			? jsonParse<unknown>(raw, { errorMessage: `${field} is not valid JSON` })
			: raw;
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NodeOperationError(this.getNode(), `${field} must be a JSON object`, {
			itemIndex: i,
		});
	}
	return value as IDataObject;
}

async function inputsOf(
	this: IExecuteFunctions,
	workflow: string,
	i: number,
): Promise<IDataObject> {
	const source = this.getNodeParameter('inputSource', i) as string;
	if (source === 'json') {
		return parseObject.call(this, this.getNodeParameter('inputsJson', i, '{}'), 'Inputs (JSON)', i);
	}
	const pairs = this.getNodeParameter('inputs.input', i, []) as Array<{
		name?: string;
		value?: unknown;
	}>;
	const inputs: IDataObject = {};
	let files: Set<string> | undefined;
	for (const pair of pairs) {
		const name = String(pair.name ?? '').trim();
		if (!name) {
			throw new NodeOperationError(this.getNode(), 'An input has no name: pick one from the list', {
				itemIndex: i,
			});
		}
		let value = pair.value;
		// a files input takes a list: "101, 102" or an expression's array
		if (typeof value === 'string' && (value.includes(',') || value.trim().startsWith('['))) {
			files ??= await filesInputs.call(this, workflow, i);
			if (files.has(name)) {
				const text = value.trim();
				value = text.startsWith('[')
					? toIdList(jsonParse<unknown>(text, { fallbackValue: text }))
					: toIdList(text);
			}
		}
		inputs[name] = value as IDataObject[string];
	}
	return inputs;
}

/** Reads the run until it ends, or until the timeout or the execution's cancel. */
async function waitForRun(
	this: IExecuteFunctions,
	run: IDataObject,
	i: number,
): Promise<IDataObject> {
	const timeoutMinutes = this.getNodeParameter('timeoutMinutes', i, 15) as number;
	const pollSeconds = Math.max(2, this.getNodeParameter('pollSeconds', i, 5) as number);
	const deadline = Date.now() + timeoutMinutes * 60_000;
	const signal = this.getExecutionCancelSignal?.();
	const id = String(run.id);
	let current = run;
	while (!FINAL.has(String(current.status))) {
		if (signal?.aborted) {
			throw new NodeOperationError(
				this.getNode(),
				'The execution was stopped while waiting for the run',
				{
					itemIndex: i,
					description: `Run ${id} keeps going in Studio: stop it with Studio Run → Cancel.`,
				},
			);
		}
		const left = deadline - Date.now();
		if (left <= 0) {
			throw new NodeOperationError(
				this.getNode(),
				`The run did not end within ${timeoutMinutes} min`,
				{
					itemIndex: i,
					description: `Run ${id} is ${String(current.status)} and keeps going in Studio: read it later with Studio Run → Get, or raise the timeout.`,
				},
			);
		}
		await sleep(Math.min(pollSeconds * 1000, left));
		current = await apiRequest.call(this, 'GET', `/v1/studio/runs/${encodeURIComponent(id)}`, {
			itemIndex: i,
		});
	}
	if (current.status !== 'completed') {
		throw new NodeOperationError(
			this.getNode(),
			current.status === 'failed'
				? `The run failed: ${String(current.error ?? 'no reason given')}`
				: 'The run was canceled',
			{ itemIndex: i, description: `Run ${id}` },
		);
	}
	return current;
}

export async function executeStudioRun(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'start') {
		const workflow = String(
			this.getNodeParameter('workflowId', i, '', { extractValue: true }),
		).trim();
		if (!workflow)
			throw new NodeOperationError(this.getNode(), 'Pick a workflow', { itemIndex: i });
		const options = this.getNodeParameter('options', i, {}) as IDataObject;
		const body: IDataObject = {
			workflow,
			inputs: await inputsOf.call(this, workflow, i),
			speed: this.getNodeParameter('speed', i, 'standard') as string,
		};
		const advanced = parseObject.call(this, options.advanced, 'Advanced Settings (JSON)', i);
		if (Object.keys(advanced).length) body.advanced = advanced;
		if (typeof options.webhookUrl === 'string' && options.webhookUrl.trim()) {
			body.webhook_url = options.webhookUrl.trim();
		}
		const key = idempotencyKey.call(this, 'studio-run', i, body);
		const run = await apiRequest.call(this, 'POST', '/v1/studio/runs', {
			body,
			headers: key ? { 'Idempotency-Key': key } : undefined,
			itemIndex: i,
		});
		if (!(this.getNodeParameter('waitForCompletion', i, true) as boolean)) return run;
		return await waitForRun.call(this, run, i);
	}
	if (operation === 'get' || operation === 'cancel') {
		const id = String(this.getNodeParameter('runId', i)).trim();
		if (!id) throw new NodeOperationError(this.getNode(), 'Give a run ID', { itemIndex: i });
		const path = `/v1/studio/runs/${encodeURIComponent(id)}`;
		return operation === 'get'
			? await apiRequest.call(this, 'GET', path, { itemIndex: i })
			: await apiRequest.call(this, 'POST', `${path}/cancel`, { itemIndex: i });
	}
	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i, {}) as IDataObject;
		return await apiRequestOffsetPages.call(
			this,
			'/v1/studio/runs',
			{ status: filters.status, workflow: filters.workflow },
			this.getNodeParameter('returnAll', i) as boolean,
			this.getNodeParameter('limit', i, 50) as number,
			i,
		);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
