import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { accountDescription, executeAccount } from './resources/account';
import { executeMedia, mediaDescription } from './resources/media';
import { executeSlateAccount, slateAccountDescription } from './resources/slateAccount';
import { executeSlatePost, slatePostDescription } from './resources/slatePost';
import { executeStudioRun, studioRunDescription } from './resources/studioRun';
import { executeStudioWorkflow, studioWorkflowDescription } from './resources/studioWorkflow';
import { getAccounts, getWorkflowInputs, getWorkflows, searchWorkflows } from './shared/methods';
import { asNodeError } from './shared/transport';

type Handler = (
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
) => Promise<IDataObject | IDataObject[]>;

const HANDLERS: Record<string, Handler> = {
	account: executeAccount,
	media: executeMedia,
	slateAccount: executeSlateAccount,
	slatePost: executeSlatePost,
	studioRun: executeStudioRun,
	studioWorkflow: executeStudioWorkflow,
};

export class NeverManual implements INodeType {
	// Programmatic: a run is started and then read until it ends, files go up as multipart from binary data,
	// lists follow next_cursor, and the API's { error: { code, message } } becomes the node's error — more than
	// declarative routing describes.
	description: INodeTypeDescription = {
		displayName: 'Never Manual',
		name: 'neverManual',
		icon: {
			light: 'file:../../icons/nevermanual.svg',
			dark: 'file:../../icons/nevermanual.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Run Studio workflows, add files to Media and post to social accounts with Slate',
		defaults: {
			name: 'Never Manual',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'neverManualApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
						description: 'The API key and its workspace',
					},
					{
						name: 'Media',
						value: 'media',
						description: "The workspace's files: what runs take and make, what posts carry",
					},
					{
						name: 'Slate Account',
						value: 'slateAccount',
						description: "The workspace's social accounts",
					},
					{
						name: 'Slate Post',
						value: 'slatePost',
						description: 'Posts of Media files to social accounts',
					},
					{
						name: 'Studio Run',
						value: 'studioRun',
						description: 'A run of a Studio workflow and the files it made',
					},
					{
						name: 'Studio Workflow',
						value: 'studioWorkflow',
						description: 'What Studio can run, and the inputs each takes',
					},
				],
				default: 'studioRun',
			},
			...accountDescription,
			...mediaDescription,
			...slateAccountDescription,
			...slatePostDescription,
			...studioRunDescription,
			...studioWorkflowDescription,
		],
	};

	methods = {
		listSearch: {
			searchWorkflows,
		},
		loadOptions: {
			getAccounts,
			getWorkflowInputs,
			getWorkflows,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			let result: IDataObject | IDataObject[];
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const handler = HANDLERS[resource];
				if (!handler) {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
						itemIndex: i,
					});
				}
				result = await handler.call(this, operation, i);
			} catch (error) {
				if (!this.continueOnFail()) throw asNodeError(this.getNode(), error, i);
				const failed = asNodeError(this.getNode(), error, i);
				const json: IDataObject = { error: failed.message };
				if (failed.description) json.description = failed.description;
				if (failed.context.apiCode) json.code = failed.context.apiCode;
				if ('httpCode' in failed && failed.httpCode) json.httpCode = failed.httpCode;
				returnData.push({ json, pairedItem: { item: i } });
				continue;
			}
			const executionData = this.helpers.constructExecutionMetaData(
				this.helpers.returnJsonArray(result),
				{ itemData: { item: i } },
			);
			returnData.push(...executionData);
		}

		return [returnData];
	}
}
