import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NeverManualApi implements ICredentialType {
	name = 'neverManualApi';

	displayName = 'Never Manual API';

	icon: Icon = {
		light: 'file:../icons/nevermanual.svg',
		dark: 'file:../icons/nevermanual.dark.svg',
	};

	documentationUrl = 'https://github.com/nevermanual/n8n-nodes-nevermanual#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'nmk_...',
			description:
				'A workspace key from Accounts → API keys. A read-only key lists and reads; starting runs, adding files, posting and the trigger need full access.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.nevermanual.cloud',
			description: 'Leave as is unless Never Manual gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{($credentials.baseUrl || "https://api.nevermanual.cloud").replace(/\\/+$/, "")}}',
			url: '/v1/me',
			method: 'GET',
		},
	};
}
