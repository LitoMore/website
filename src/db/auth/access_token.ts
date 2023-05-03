import { PUBLIC_GITHUB_ID } from '$env/static/public';
import { GITHUB_SECRET } from '$env/static/private';
const tokenURL = 'https://github.com/login/oauth/access_token';

export async function get_access_token(code: string): Promise<string> {
	try {
		const response = await fetch(tokenURL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				client_id: PUBLIC_GITHUB_ID,
				client_secret: GITHUB_SECRET,
				code
			})
		});

		if (!response.ok) {
			throw new Error(`Error fetching access token: ${response.statusText}`);
		}

		const data = await response.json();
		return data.access_token;
	} catch (error) {
		console.error('Error:', error);
		throw error;
	}
}
