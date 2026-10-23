import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { apiRequest, apiRequestFull } from '../NeverManual/shared/transport';

/** A delivery signed longer ago than this is refused: a replayed request, or a clock far off. */
const MAX_AGE_SECONDS = 300;

interface Subscription {
	id: string;
	url: string;
	events?: string[];
	secret?: string;
}

const sameEvents = (a: string[] = [], b: string[] = []) =>
	a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * `NM-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, checked over the exact bytes received
 * and refused when older than five minutes.
 */
export function verifySignature(
	secret: string,
	header: string,
	rawBody: Buffer,
	nowSeconds: number,
): boolean {
	let t = '';
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const at = part.indexOf('=');
		if (at < 0) continue;
		const key = part.slice(0, at).trim();
		const value = part.slice(at + 1).trim();
		if (key === 't') t = value;
		else if (key === 'v1') signatures.push(value);
	}
	const sentAt = Number(t);
	if (!/^\d+$/.test(t) || !signatures.length) return false;
	if (Math.abs(nowSeconds - sentAt) > MAX_AGE_SECONDS) return false;
	const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
	return signatures.some((hex) => {
		if (!/^[0-9a-f]+$/i.test(hex)) return false;
		const got = Buffer.from(hex, 'hex');
		return got.length === expected.length && timingSafeEqual(got, expected);
	});
}

export class NeverManualTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Never Manual Trigger',
		name: 'neverManualTrigger',
		icon: {
			light: 'file:../../icons/nevermanual.svg',
			dark: 'file:../../icons/nevermanual.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a Studio run ends or a Slate post is published or fails',
		defaults: {
			name: 'Never Manual Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'neverManualApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The events that start the workflow',
				options: [
					{
						name: 'Post Failed',
						value: 'post.failed',
						description: 'A Slate post failed; the event says why',
					},
					{
						name: 'Post Published',
						value: 'post.published',
						description: 'A Slate post went out; the event carries its link',
					},
					{
						name: 'Run Canceled',
						value: 'run.canceled',
						description: 'A Studio run was stopped',
					},
					{
						name: 'Run Completed',
						value: 'run.completed',
						description: 'A Studio run ended with its files, with download links',
					},
					{
						name: 'Run Failed',
						value: 'run.failed',
						description: 'A Studio run failed; the event says why',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const staticData = this.getWorkflowStaticData('node');
				const events = this.getNodeParameter('events', []) as string[];
				const answer = await apiRequest.call(this, 'GET', '/v1/webhooks');
				const subscriptions = (answer.data as Subscription[] | undefined) ?? [];
				let exists = false;
				for (const subscription of subscriptions) {
					if (subscription.url !== webhookUrl) continue;
					if (
						!exists &&
						subscription.id === staticData.webhookId &&
						typeof staticData.secret === 'string' &&
						sameEvents(subscription.events, events)
					) {
						exists = true;
						continue;
					}
					// this node's address from before, but its secret is not kept here or its events changed:
					// it goes, and create() makes one whose secret this node knows
					await apiRequestFull.call(
						this,
						'DELETE',
						`/v1/webhooks/${encodeURIComponent(subscription.id)}`,
						{
							allowStatus: [404],
						},
					);
				}
				return exists;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events', []) as string[];
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'n8n gave no webhook address for this node');
				}
				if (!events.length) {
					throw new NodeOperationError(this.getNode(), 'Pick at least one event');
				}
				const made = (await apiRequest.call(this, 'POST', '/v1/webhooks', {
					body: { url: webhookUrl, events },
				})) as unknown as Subscription;
				if (!made.id || !made.secret) {
					throw new NodeOperationError(
						this.getNode(),
						'Never Manual did not return the webhook and its secret',
					);
				}
				const staticData = this.getWorkflowStaticData('node');
				staticData.webhookId = made.id;
				staticData.secret = made.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				if (typeof staticData.webhookId === 'string' && staticData.webhookId) {
					// a 404 is fine: it was deleted already
					await apiRequestFull.call(
						this,
						'DELETE',
						`/v1/webhooks/${encodeURIComponent(staticData.webhookId)}`,
						{ allowStatus: [404] },
					);
				}
				delete staticData.webhookId;
				delete staticData.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const staticData = this.getWorkflowStaticData('node');
		const secret = typeof staticData.secret === 'string' ? staticData.secret : '';
		const header = this.getHeaderData()['nm-signature'];
		const signature = Array.isArray(header) ? header[0] : header;
		const request = this.getRequestObject() as unknown as { rawBody?: unknown };
		const body = this.getBodyData();
		// the signature is over the exact bytes; n8n keeps them as rawBody (the API sends compact JSON otherwise)
		const rawBody = Buffer.isBuffer(request.rawBody)
			? request.rawBody
			: Buffer.from(
					typeof request.rawBody === 'string' ? request.rawBody : JSON.stringify(body),
					'utf8',
				);

		if (
			!secret ||
			!signature ||
			!verifySignature(secret, signature, rawBody, Math.floor(Date.now() / 1000))
		) {
			const response = this.getResponseObject();
			response.status(401).json({ error: 'The NM-Signature header is missing, wrong or too old' });
			return { noWebhookResponse: true };
		}

		const events = this.getNodeParameter('events', []) as string[];
		if (events.length && !events.includes(String(body.type))) {
			// signed, but not an event this node listens to: answered, and the workflow does not start
			return { webhookResponse: { received: true } };
		}

		return {
			workflowData: [this.helpers.returnJsonArray(body as IDataObject)],
		};
	}
}
