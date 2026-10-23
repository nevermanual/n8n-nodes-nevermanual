import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { returnAllAndLimit } from '../shared/descriptions';
import { apiRequest } from '../shared/transport';

const show = { resource: ['slateAccount'] };

export const slateAccountDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				description:
					"List the workspace's social accounts: platform, handle, and how Slate posts to each (API, phone or by hand)",
				action: 'Get many social accounts',
			},
		],
		default: 'getAll',
	},
	...returnAllAndLimit({ ...show, operation: ['getAll'] }),
];

export async function executeSlateAccount(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getAll') {
		const answer = await apiRequest.call(this, 'GET', '/v1/slate/accounts', { itemIndex: i });
		const all = (answer.data as IDataObject[] | undefined) ?? [];
		if (this.getNodeParameter('returnAll', i) as boolean) return all;
		return all.slice(0, this.getNodeParameter('limit', i) as number);
	}
	throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
}
