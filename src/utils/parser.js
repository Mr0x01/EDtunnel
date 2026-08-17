/**
 * Parser utilities for addresses and parameters
 */

import { fumidais } from '../config/defaults.js';

/**
 * Parses a VLESS URL into configuration object
 * Format: vless://uuid@host:port?type=ws&security=tls&path=/path&sni=host#name
 * @param {string} url - VLESS URL string
 * @returns {{
 *   uuid: string,
 *   address: string,
 *   port: number,
 *   streamSettings: {
 *     network: string,
 *     security: string,
 *     wsSettings?: { path: string, headers?: Object },
 *     tlsSettings?: { serverName: string }
 *   }
 * }|null} Parsed configuration or null if invalid
 */
export function parseVlessUrl(url) {
	if (!url || !url.startsWith('vless://')) {
		return null;
	}

	try {
		// Remove 'vless://' prefix and fragment
		const urlWithoutProtocol = url.slice(8).split('#')[0];

		// Split by @ to get uuid and rest
		const atIndex = urlWithoutProtocol.indexOf('@');
		if (atIndex === -1) return null;

		const uuid = urlWithoutProtocol.slice(0, atIndex);
		const rest = urlWithoutProtocol.slice(atIndex + 1);

		// Parse host:port and query string
		const [hostPort, queryString] = rest.split('?');

		// Handle IPv6 addresses in brackets
		let address, port;
		if (hostPort.startsWith('[')) {
			// IPv6 format: [::1]:port
			const bracketEnd = hostPort.indexOf(']');
			if (bracketEnd === -1) return null;
			address = hostPort.slice(1, bracketEnd);
			const portPart = hostPort.slice(bracketEnd + 1);
			if (portPart.startsWith(':')) {
				port = parseInt(portPart.slice(1), 10);
			} else {
				port = 443; // default port
			}
		} else {
			// IPv4 or domain format
			const colonIndex = hostPort.lastIndexOf(':');
			if (colonIndex === -1) {
				address = hostPort;
				port = 443; // default port
			} else {
				address = hostPort.slice(0, colonIndex);
				port = parseInt(hostPort.slice(colonIndex + 1), 10);
			}
		}

		if (isNaN(port)) port = 443;

		// Parse query parameters
		const params = {};
		if (queryString) {
			queryString.split('&').forEach((pair) => {
				const [key, value] = pair.split('=');
				if (key) {
					params[decodeURIComponent(key)] = decodeURIComponent(value || '');
				}
			});
		}

		// Build stream settings
		const streamSettings = {
			network: params.type || 'ws',
			security: params.security || 'none',
		};

		if (streamSettings.network === 'ws') {
			streamSettings.wsSettings = {
				path: params.path || '/',
			};
			if (params.host) {
				streamSettings.wsSettings.headers = { Host: params.host };
			}
		}

		if (streamSettings.security === 'tls') {
			streamSettings.tlsSettings = {
				serverName: params.sni || params.host || address,
			};
		}

		return { uuid, address, port, streamSettings };
	} catch (e) {
		console.error('[VLESS] Failed to parse URL:', e);
		return null;
	}
}

/**
 * Parses SOCKS5 address string into components.
 * @param {string} address - SOCKS5 address string (format: 'username:password@host:port' or 'host:port')
 * @returns {{username: string|undefined, password: string|undefined, hostname: string, port: number}} Parsed address information
 * @throws {Error} If address format is invalid
 */
export function socks5AddressParser(address) {
	let [latter, former] = address.split("@").reverse();
	let username, password, hostname, port;
	if (former) {
		const formers = former.split(":");
		if (formers.length !== 2) {
			throw new Error('Invalid SOCKS address format');
		}
		[username, password] = formers;
	}
	const latters = latter.split(":");
	port = Number(latters.pop());
	if (isNaN(port)) {
		throw new Error('Invalid SOCKS address format');
	}
	hostname = latters.join(":");
	const regex = /^\[.*\]$/;
	if (hostname.includes(":") && !regex.test(hostname)) {
		throw new Error('Invalid SOCKS address format');
	}
	return {
		username,
		password,
		hostname,
		port,
	};
}

/**
 * Handles fumidai configuration and returns standardized fumidai settings.
 * @param {string} FUMIDAI - Fumidai IP configuration from environment
 * @returns {{ip: string, port: string}} Standardized fumidai configuration
 */
export function handleFumidaiConfig(FUMIDAI) {
	if (FUMIDAI) {
		const fumidaiAddresses = FUMIDAI.split(',').map(addr => addr.trim());
		const selectedFumidai = selectRandomAddress(fumidaiAddresses);
		const [ip, port = '443'] = selectedFumidai.split(':');
		return { ip, port };
	} else {
		// Use default from fumidais
		const defaultFumidai = fumidais[Math.floor(Math.random() * fumidais.length)];
		const port = defaultFumidai.includes(':') ? defaultFumidai.split(':')[1] : '443';
		const ip = defaultFumidai.split(':')[0];
		return { ip, port };
	}
}

/**
 * Selects a random address from a comma-separated string or array of addresses.
 * @param {string|string[]} addresses - Comma-separated string or array of addresses
 * @returns {string} Selected address
 */
export function selectRandomAddress(addresses) {
	const addressArray = typeof addresses === 'string' ?
		addresses.split(',').map(addr => addr.trim()) :
		addresses;
	return addressArray[Math.floor(Math.random() * addressArray.length)];
}

/**
 * Parses encoded query parameters from URL pathname.
 * Handles parameters encoded with %3F (?) in the path.
 * @param {string} pathname - URL path
 * @returns {Object} Parsed parameters object
 */
export function parseEncodedQueryParams(pathname) {
	const params = {};
	if (pathname.includes('%3F')) {
		const encodedParamsMatch = pathname.match(/%3F(.+)$/);
		if (encodedParamsMatch) {
			const encodedParams = encodedParamsMatch[1];
			const paramPairs = encodedParams.split('&');

			for (const pair of paramPairs) {
				const [key, value] = pair.split('=');
				if (value) params[key] = decodeURIComponent(value);
			}
		}
	}
	return params;
}

/**
 * Decodes fumidai address with Base64 encoded username:password.
 * @param {string} address - Address string (may contain Base64 encoded credentials)
 * @returns {string} Decoded address string
 */
function decodeFumidaiAddress(address) {
	if (!address.includes('@')) return address;

	const atIndex = address.lastIndexOf('@');
	let userPass = address.substring(0, atIndex).replace(/%3D/gi, '=');
	const hostPort = address.substring(atIndex + 1);

	// Try Base64 decode if it looks like Base64 and doesn't contain ':'
	if (/^[A-Za-z0-9+/]+=*$/.test(userPass) && !userPass.includes(':')) {
		try {
			userPass = atob(userPass);
		} catch (e) {
			// Not valid Base64, keep original
		}
	}

	return `${userPass}@${hostPort}`;
}

/**
 * Parses path-based fumidai parameters.
 * Supports formats: /fumidai=, /fumidai., /socks5=, /socks://, /socks5://, /http=, /http://, /vless://
 * @param {string} pathname - URL pathname
 * @returns {{fumidai: string|null, socks5: string|null, http: string|null, vless: string|null, globalFumidai: boolean}} Parsed parameters
 */
export function parsePathFumidaiParams(pathname) {
	const result = {
		fumidai: null,
		socks5: null,
		http: null,
		vless: null,
		globalFumidai: false
	};

	// 1. Match /fumidai=host:port, /fumidai.domain.com, /pyip=, /ip=
	const fumidaiMatch = pathname.match(/^\/(fumidai[.=]|pyip=|ip=)([^/?#]+)/i);
	if (fumidaiMatch) {
		const prefix = fumidaiMatch[1].toLowerCase();
		const value = fumidaiMatch[2];
		result.fumidai = prefix === 'fumidai.' ? `fumidai.${value}` : value;
		return result;
	}

	// 2. Match /socks://base64@host:port or /socks5://user:pass@host:port
	const socksUrlMatch = pathname.match(/^\/(socks5?):\/\/?([^/?#]+)/i);
	if (socksUrlMatch) {
		result.socks5 = decodeFumidaiAddress(socksUrlMatch[2]);
		result.globalFumidai = true;
		return result;
	}

	// 3. Match /socks5=, /socks=, /s5=, /gs5=, /gsocks5=
	const socksEqMatch = pathname.match(/^\/(g?s5|g?socks5?)=([^/?#]+)/i);
	if (socksEqMatch) {
		const type = socksEqMatch[1].toLowerCase();
		result.socks5 = socksEqMatch[2];
		// g prefix enables global fumidai mode
		if (type.startsWith('g')) {
			result.globalFumidai = true;
		}
		return result;
	}

	// 4. Match /http://user:pass@host:port
	const httpUrlMatch = pathname.match(/^\/http:\/\/?([^/?#]+)/i);
	if (httpUrlMatch) {
		result.http = decodeFumidaiAddress(httpUrlMatch[1]);
		result.globalFumidai = true;
		return result;
	}

	// 5. Match /http=user:pass@host:port or /ghttp= (global mode)
	const httpEqMatch = pathname.match(/^\/(g?http)=([^/?#]+)/i);
	if (httpEqMatch) {
		const type = httpEqMatch[1].toLowerCase();
		result.http = httpEqMatch[2];
		// g prefix enables global fumidai mode
		if (type.startsWith('g')) {
			result.globalFumidai = true;
		}
		return result;
	}

	// 6. Match /vless://uuid@host:port?...  (VLESS outbound, always global)
	const vlessUrlMatch = pathname.match(/^\/vless:\/\/([^/?#]+)/i);
	if (vlessUrlMatch) {
		// Reconstruct the full VLESS URL
		const vlessPath = pathname.slice(1); // Remove leading /
		result.vless = vlessPath;
		result.globalFumidai = true;
		return result;
	}

	// 7. Match /vless= or /gvless= (g prefix enables global fumidai mode)
	const vlessEqMatch = pathname.match(/^\/(g?vless)=([^/?#]+)/i);
	if (vlessEqMatch) {
		const type = vlessEqMatch[1].toLowerCase();
		result.vless = decodeURIComponent(vlessEqMatch[2]);
		// g prefix enables global fumidai mode
		if (type.startsWith('g')) {
			result.globalFumidai = true;
		}
		return result;
	}

	return result;
}
