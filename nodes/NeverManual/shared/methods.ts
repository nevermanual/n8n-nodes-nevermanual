import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';
import { apiRequest, encodeIdPath } from './transport';

interface Workflow extends IDataObject {
	id: string;
	name: string;
	category?: string;
	made_by?: string;
}

interface WorkflowInput extends IDataObject {
	name: string;
	label?: string;
	type?: string;
	required?: boolean;
	help?: string | null;
}

interface SocialAccount extends IDataObject {
	id: number;
	platform?: string;
	handle?: string | null;
	posting?: string;
	connected?: boolean;
}

async function workflows(this: ILoadOptionsFunctions): Promise<Workflow[]> {
	const answer = await apiRequest.call(this, 'GET', '/v1/studio/workflows');
	return ((answer.data as Workflow[] | undefined) ?? []).filter((w) => typeof w.id === 'string');
}

function workflowLabel(w: Workflow): string {
	return w.made_by === 'workspace' ? `${w.name} (yours)` : w.name;
}

/** Studio's workflows for a resource locator, searched by name or id. */
export async function searchWorkflows(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const needle = (filter ?? '').trim().toLowerCase();
	const results = (await workflows.call(this))
		.filter(
			(w) =>
				!needle || w.name.toLowerCase().includes(needle) || w.id.toLowerCase().includes(needle),
		)
		.map((w) => ({ name: workflowLabel(w), value: w.id }));
	return { results };
}

/** Studio's workflows as plain options (the Get Many filter). */
export async function getWorkflows(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return (await workflows.call(this))
		.map((w) => ({
			name: workflowLabel(w),
			value: w.id,
			description: w.category ? `${w.category} · ${w.id}` : w.id,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The inputs the chosen workflow takes, by the names a run is started with. */
export async function getWorkflowInputs(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const id = this.getCurrentNodeParameter('workflowId', { extractValue: true });
	if (typeof id !== 'string' || !id.trim()) return [];
	const detail = await apiRequest.call(
		this,
		'GET',
		`/v1/studio/workflows/${encodeIdPath(id.trim())}`,
	);
	const inputs = (detail.inputs as WorkflowInput[] | undefined) ?? [];
	return inputs.map((input) => {
		const kind = input.type ?? 'text';
		const label =
			input.label && input.label !== input.name ? `${input.name} — ${input.label}` : input.name;
		const help = [
			`${kind}${input.required ? ', required' : ''}`,
			kind === 'image' || kind === 'video' || kind === 'audio'
				? 'a Media ID or an http(s) link'
				: kind === 'files'
					? 'Media IDs or links, separated by commas'
					: undefined,
			input.help ?? undefined,
		]
			.filter(Boolean)
			.join('. ');
		return { name: label, value: input.name, description: help };
	});
}

/** The workspace's social accounts in Slate. */
export async function getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const answer = await apiRequest.call(this, 'GET', '/v1/slate/accounts');
	const accounts = (answer.data as SocialAccount[] | undefined) ?? [];
	return accounts
		.map((a) => ({
			name: `${a.handle ? a.handle : `#${a.id}`} (${a.platform ?? 'account'})`,
			value: a.id,
			description: `Posts by ${a.posting ?? 'api'}${a.connected === false ? ', not connected yet' : ''}`,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}
