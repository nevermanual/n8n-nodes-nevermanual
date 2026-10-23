import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest } from '../shared/transport';

const show = { resource: ['account'] };

export const accountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Get Me',
				value: 'getMe',
				description: "Get the API key, its workspace and the workspace's balance",
				action: 'Get the key and its workspace',
			},
		],
		default: 'getMe',
	},
];

export async function executeAccount(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getMe') {
		return await apiRequest.call(this, 'GET', '/v1/me', { itemIndex: i });
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
