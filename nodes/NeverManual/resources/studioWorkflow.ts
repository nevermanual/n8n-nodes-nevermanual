import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { returnAllAndLimit, workflowLocator } from '../shared/descriptions';
import { apiRequest, encodeIdPath } from '../shared/transport';

const show = { resource: ['studioWorkflow'] };

export const studioWorkflowDescription: INodeProperties[] = [
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
				description: 'Get a workflow and the inputs a run takes',
				action: 'Get a workflow',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				description: "List what Studio can run: Studio's workflows and the workspace's own",
				action: 'Get many workflows',
			},
		],
		default: 'getAll',
	},
	workflowLocator(
		{ ...show, operation: ['get'] },
		'The workflow to read: its inputs give the names a run is started with',
	),
	...returnAllAndLimit({ ...show, operation: ['getAll'] }),
];

export async function executeStudioWorkflow(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'get') {
		const id = String(this.getNodeParameter('workflowId', i, '', { extractValue: true })).trim();
		if (!id) throw new NodeOperationError(this.getNode(), 'Pick a workflow', { itemIndex: i });
		return await apiRequest.call(this, 'GET', `/v1/studio/workflows/${encodeIdPath(id)}`, {
			itemIndex: i,
		});
	}
	if (operation === 'getAll') {
		const answer = await apiRequest.call(this, 'GET', '/v1/studio/workflows', { itemIndex: i });
		const all = (answer.data as IDataObject[] | undefined) ?? [];
		if (this.getNodeParameter('returnAll', i) as boolean) return all;
		return all.slice(0, this.getNodeParameter('limit', i) as number);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
