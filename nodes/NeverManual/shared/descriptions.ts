import type { IDataObject, IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

/** The workflow picker: from Studio's list, or an id typed or given by an expression. */
export function workflowLocator(show: Show, description: string): INodeProperties {
	return {
		displayName: 'Workflow',
		name: 'workflowId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description,
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'searchWorkflows',
					searchable: true,
				},
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. face-swap',
			},
		],
	};
}

/** The usual Return All / Limit pair of a Get Many operation. */
export function returnAllAndLimit(show: Show): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions: { show },
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: {
				minValue: 1,
			},
			description: 'Max number of results to return',
			displayOptions: { show: { ...show, returnAll: [false] } },
		},
	];
}

/** Media ids and links from a comma or space separated string, a number, or a list an expression gave. */
export function toIdList(value: unknown): Array<number | string> {
	const raw: unknown[] = Array.isArray(value)
		? value
		: typeof value === 'string'
			? value.split(/[\s,]+/)
			: value === undefined || value === null
				? []
				: [value];
	const out: Array<number | string> = [];
	for (const item of raw) {
		if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
		else if (item && typeof item === 'object' && 'media_id' in item) {
			out.push(...toIdList((item as IDataObject).media_id));
		} else if (item && typeof item === 'object' && 'id' in item) {
			out.push(...toIdList((item as IDataObject).id));
		} else if (typeof item === 'string' && item.trim()) {
			const s = item.trim();
			out.push(/^\d+$/.test(s) ? Number(s) : s);
		}
	}
	return out;
}
