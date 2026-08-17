/**
 * Fumidai address resolver with DNS resolution and caching
 * Inspired by ref_code.js multi-fumidai rotation mechanism
 */

// Cache for resolved fumidai addresses
let cachedFumidai = null;
let cachedFumidaiAddresses = null;
let cachedFumidaiIndex = 0;

/**
 * Performs DNS over HTTPS query
 * @param {string} domain - Domain to query
 * @param {string} recordType - DNS record type ('A', 'AAAA', 'TXT')
 * @returns {Promise<Array>} DNS answer records
 */
async function dohQuery(domain, recordType) {
	try {
		const response = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=${recordType}`, {
			headers: { 'Accept': 'application/dns-json' }
		});
		if (!response.ok) return [];
		const data = await response.json();
		return data.Answer || [];
	} catch (error) {
		console.error(`DoH query failed (${recordType}):`, error);
		return [];
	}
}

/**
 * Parses address:port string into components
 * Handles IPv4, IPv6, and domain names
 * @param {string} str - Address string (e.g., 'host:port', '[ipv6]:port')
 * @returns {[string, number]} Tuple of [address, port]
 */
function parseAddressPort(str) {
	let address = str;
	let port = 443;

	if (str.includes(']:')) {
		// IPv6 with port: [2001:db8::1]:443
		const parts = str.split(']:');
		address = parts[0] + ']';
		port = parseInt(parts[1], 10) || port;
	} else if (str.includes(':') && !str.startsWith('[')) {
		// IPv4 or domain with port: 1.2.3.4:443 or domain.com:443
		const colonIndex = str.lastIndexOf(':');
		address = str.slice(0, colonIndex);
		port = parseInt(str.slice(colonIndex + 1), 10) || port;
	}

	return [address, port];
}

/**
 * Generates a deterministic random seed from strings
 * @param {string} targetDomain - Target domain
 * @param {string} userID - User ID
 * @returns {number} Seed value
 */
function generateSeed(targetDomain, userID) {
	const rootDomain = targetDomain.includes('.')
		? targetDomain.split('.').slice(-2).join('.')
		: targetDomain;
	return [...(rootDomain + userID)].reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

/**
 * Shuffles array using Linear Congruential Generator with seed
 * @param {Array} array - Array to shuffle
 * @param {number} seed - Random seed
 * @returns {Array} Shuffled array
 */
function seededShuffle(array, seed) {
	const shuffled = [...array];
	let currentSeed = seed;

	shuffled.sort(() => {
		currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
		return currentSeed / 0x7fffffff - 0.5;
	});

	return shuffled;
}

/**
 * Resolves fumidai address(es) with DNS resolution and caching
 * @param {string} fumidai - Fumidai IP/domain configuration
 * @param {string} targetDomain - Target domain for seed generation
 * @param {string} userID - User ID for seed generation
 * @returns {Promise<Array<[string, number]>>} Array of [address, port] tuples
 */
export async function resolveFumidaiAddresses(fumidai, targetDomain = 'cloudflare.com', userID = '') {
	// Return cached if same fumidai
	if (cachedFumidai && cachedFumidaiAddresses && cachedFumidai === fumidai) {
		console.log(`[FumidaiResolver] Using cached addresses (${cachedFumidaiAddresses.length} entries)`);
		return cachedFumidaiAddresses;
	}

	const normalizedFumidai = fumidai.toLowerCase();
	let fumidaiAddresses = [];

	// Check if it's a special TXT record domain (e.g., .william domains)
	if (normalizedFumidai.includes('.william')) {
		try {
			const txtRecords = await dohQuery(normalizedFumidai, 'TXT');
			const txtData = txtRecords.filter(r => r.type === 16).map(r => r.data);

			if (txtData.length > 0) {
				let data = txtData[0];
				// Remove surrounding quotes
				if (data.startsWith('"') && data.endsWith('"')) {
					data = data.slice(1, -1);
				}
				// Parse comma/newline separated addresses
				const addresses = data
					.replace(/\\010/g, ',')
					.replace(/\n/g, ',')
					.split(',')
					.map(s => s.trim())
					.filter(Boolean);

				fumidaiAddresses = addresses.map(addr => parseAddressPort(addr));
			}
		} catch (error) {
			console.error('[FumidaiResolver] Failed to parse TXT domain:', error);
		}
	} else {
		let [address, port] = parseAddressPort(normalizedFumidai);

		// Check for .tp<port> format (e.g., domain.tp443.example.com)
		const tpMatch = normalizedFumidai.match(/\.tp(\d+)/);
		if (tpMatch) {
			port = parseInt(tpMatch[1], 10);
		}

		// Check if address is a domain (not an IP)
		const ipv4Regex = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
		const ipv6Regex = /^\[?([a-fA-F0-9:]+)\]?$/;

		if (!ipv4Regex.test(address) && !ipv6Regex.test(address)) {
			// Resolve domain to IPs using DoH
			const [aRecords, aaaaRecords] = await Promise.all([
				dohQuery(address, 'A'),
				dohQuery(address, 'AAAA')
			]);

			const ipv4List = aRecords.filter(r => r.type === 1).map(r => r.data);
			const ipv6List = aaaaRecords.filter(r => r.type === 28).map(r => `[${r.data}]`);
			const ipAddresses = [...ipv4List, ...ipv6List];

			fumidaiAddresses = ipAddresses.length > 0
				? ipAddresses.map(ip => [ip, port])
				: [[address, port]];
		} else {
			fumidaiAddresses = [[address, port]];
		}
	}

	// Sort addresses for consistent ordering before shuffle
	const sortedAddresses = fumidaiAddresses.sort((a, b) => a[0].localeCompare(b[0]));

	// Shuffle with deterministic seed based on target domain
	const seed = generateSeed(targetDomain, userID);
	const shuffled = seededShuffle(sortedAddresses, seed);

	// Limit to 8 addresses max
	cachedFumidaiAddresses = shuffled.slice(0, 8);
	cachedFumidai = fumidai;

	console.log(`[FumidaiResolver] Resolved ${cachedFumidaiAddresses.length} addresses:`,
		cachedFumidaiAddresses.map(([ip, port], i) => `${i + 1}. ${ip}:${port}`).join(', '));

	return cachedFumidaiAddresses;
}

/**
 * Gets the current cached fumidai index
 * @returns {number} Current index
 */
export function getCachedFumidaiIndex() {
	return cachedFumidaiIndex;
}

/**
 * Updates the cached fumidai index after successful connection
 * @param {number} index - New index to cache
 */
export function updateCachedFumidaiIndex(index) {
	cachedFumidaiIndex = index;
}

/**
 * Resets the fumidai cache (useful for testing or config changes)
 */
export function resetFumidaiCache() {
	cachedFumidai = null;
	cachedFumidaiAddresses = null;
	cachedFumidaiIndex = 0;
}

/**
 * Attempts to connect to multiple fumidai addresses with timeout
 * @param {Array<[string, number]>} fumidaiAddresses - Array of [address, port]
 * @param {Uint8Array} initialData - Initial data to write after connection
 * @param {Function} connect - Cloudflare socket connect function
 * @param {Function} log - Logging function
 * @param {number} timeout - Connection timeout in ms (default: 1500)
 * @returns {Promise<{socket: Socket, index: number}|null>} Connected socket and index, or null
 */
export async function connectWithRotation(fumidaiAddresses, initialData, connect, log, timeout = 1500) {
	const startIndex = cachedFumidaiIndex;

	for (let i = 0; i < fumidaiAddresses.length; i++) {
		const index = (startIndex + i) % fumidaiAddresses.length;
		const [address, port] = fumidaiAddresses[index];

		try {
			log(`[FumidaiRotation] Trying ${address}:${port} (index: ${index})`);

			const socket = connect({ hostname: address, port: port });

			// Wait for connection with timeout
			await Promise.race([
				socket.opened,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Connection timeout')), timeout)
				)
			]);

			// Write initial data
			const writer = socket.writable.getWriter();
			await writer.write(initialData);
			writer.releaseLock();

			log(`[FumidaiRotation] Connected to ${address}:${port}`);
			cachedFumidaiIndex = index;

			return { socket, index };
		} catch (err) {
			log(`[FumidaiRotation] Failed ${address}:${port}: ${err.message}`);
			// Silently close failed socket
			try {
				// socket might not be defined if connect() threw
			} catch (e) { }
			continue;
		}
	}

	return null;
}
