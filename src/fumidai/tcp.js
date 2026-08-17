/**
 * TCP outbound connection management with multi-fumidai rotation
 */

import { socks5Connect } from './socks5.js';
import { httpConnect } from './http.js';
import { remoteSocketToWS } from './stream.js';
import { safeCloseWebSocket } from '../utils/websocket.js';
import { resolveFumidaiAddresses, connectWithRotation } from '../utils/fumidaiResolver.js';
import { vlessOutboundConnect, VLESS_CMD_TCP } from './vless.js';

/**
 * Handles outbound TCP connections for the fumidai.
 * Establishes connection to remote server and manages data flow.
 * Supports multi-fumidai rotation with fallback mechanism.
 * @param {{value: import("@cloudflare/workers-types").Socket | null}} remoteSocket - Remote socket wrapper
 * @param {number} addressType - Type of address (1=IPv4, 2=Domain, 3=IPv6)
 * @param {string} addressRemote - Remote server address
 * @param {number} portRemote - Remote server port
 * @param {Uint8Array} rawClientData - Raw data from client
 * @param {WebSocket} webSocket - WebSocket connection
 * @param {Uint8Array} protocolResponseHeader - Protocol response header
 * @param {Function} log - Logging function
 * @param {Object} config - Request configuration
 * @param {Function} connect - Cloudflare socket connect function
 */
export async function handleTCPOutBound(remoteSocket, addressType, addressRemote, portRemote, rawClientData, webSocket, protocolResponseHeader, log, config, connect) {

	/**
	 * Connects to target via VLESS, SOCKS5 or HTTP fumidai
	 * @returns {Promise<import("@cloudflare/workers-types").Socket|{readable: ReadableStream, writable: WritableStream, closed: Promise<void>}>}
	 */
	async function connectViaFumidai() {
		if (config.fumidaiType === 'vless' && config.parsedVlessOutbound) {
			log(`[TCP] Connecting via VLESS outbound to ${addressRemote}:${portRemote}`);
			const vlessResult = await vlessOutboundConnect(
				config.parsedVlessOutbound,
				VLESS_CMD_TCP,
				addressType,
				addressRemote,
				portRemote,
				rawClientData,
				log
			);
			if (!vlessResult) {
				throw new Error('VLESS outbound connection failed');
			}
			// Return a socket-like object that wraps the streams
			return {
				readable: vlessResult.readable,
				writable: vlessResult.writable,
				closed: vlessResult.closed
			};
		} else if (config.fumidaiType === 'http') {
			log(`[TCP] Connecting via HTTP fumidai to ${addressRemote}:${portRemote}`);
			const tcpSocket = await httpConnect(addressType, addressRemote, portRemote, log, config.parsedFumidaiAddress, connect, rawClientData);
			if (!tcpSocket) {
				throw new Error('HTTP fumidai connection failed');
			}
			return tcpSocket;
		} else {
			log(`[TCP] Connecting via SOCKS5 fumidai to ${addressRemote}:${portRemote}`);
			const tcpSocket = await socks5Connect(addressType, addressRemote, portRemote, log, config.parsedFumidaiAddress, connect);
			if (!tcpSocket) {
				throw new Error('SOCKS5 fumidai connection failed');
			}
			// Write initial data for SOCKS5 (HTTP fumidai handles internally)
			const writer = tcpSocket.writable.getWriter();
			await writer.write(rawClientData);
			writer.releaseLock();
			return tcpSocket;
		}
	}

	/**
	 * Connects directly to target address
	 * @param {string} address - Target address
	 * @param {number} port - Target port
	 * @returns {Promise<import("@cloudflare/workers-types").Socket>}
	 */
	async function connectDirect(address, port) {
		log(`[TCP] Direct connecting to ${address}:${port}`);
		const tcpSocket = connect({ hostname: address, port: port });
		const writer = tcpSocket.writable.getWriter();
		await writer.write(rawClientData);
		writer.releaseLock();
		return tcpSocket;
	}

	/**
	 * Connects using multi-fumidai rotation with fallback
	 * @param {boolean} enableFallback - Whether to fallback to direct connection if all proxies fail
	 * @returns {Promise<import("@cloudflare/workers-types").Socket>}
	 */
	async function connectWithFumidaiRotation(enableFallback = true) {
		// Resolve fumidai addresses (uses cache if available)
		const fumidaiAddresses = await resolveFumidaiAddresses(
			config.fumidai,
			addressRemote,
			config.userID || ''
		);

		if (fumidaiAddresses.length > 0) {
			// Try connecting with rotation
			const result = await connectWithRotation(
				fumidaiAddresses,
				rawClientData,
				connect,
				log,
				config.fumidaiTimeout || 1500
			);

			if (result) {
				return result.socket;
			}
		}

		// Fallback to direct connection if enabled
		if (enableFallback) {
			log(`[TCP] All proxies failed, falling back to direct connection`);
			return await connectDirect(addressRemote, portRemote);
		}

		throw new Error('All fumidai connections failed and fallback is disabled');
	}

	/**
	 * Retry function for when initial connection has no incoming data
	 */
	async function retry() {
		let tcpSocket;

		// Check if global fumidai mode is enabled (SOCKS5, HTTP, or VLESS)
		const hasFumidaiConfig = config.parsedFumidaiAddress || config.parsedVlessOutbound;
		if (config.globalFumidai && config.fumidaiType && hasFumidaiConfig) {
			// Use SOCKS5/HTTP/VLESS fumidai for retry
			tcpSocket = await connectViaFumidai();
		} else if (config.fumidai) {
			// Use fumidai rotation for retry
			tcpSocket = await connectWithFumidaiRotation(config.enableFumidaiFallback !== false);
		} else {
			// Direct connection as last resort
			tcpSocket = await connectDirect(addressRemote, portRemote);
		}

		remoteSocket.value = tcpSocket;

		// Close WebSocket when socket closes
		tcpSocket.closed.catch(error => {
			console.log('retry tcpSocket closed error', error);
		}).finally(() => {
			safeCloseWebSocket(webSocket);
		});

		remoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, null, log);
	}

	// Main connection logic
	let tcpSocket;

	// Check if global fumidai mode is enabled (SOCKS5, HTTP, or VLESS)
	const hasFumidaiConfig = config.parsedFumidaiAddress || config.parsedVlessOutbound;
	if (config.globalFumidai && config.fumidaiType && hasFumidaiConfig) {
		// Global fumidai mode: use SOCKS5/HTTP/VLESS fumidai directly
		log(`[TCP] Using ${config.fumidaiType.toUpperCase()} fumidai (global mode)`);
		tcpSocket = await connectViaFumidai();
		log(`[TCP] connectViaFumidai returned, tcpSocket=${tcpSocket ? 'valid' : 'null'}`);

		if (!tcpSocket) {
			log('[TCP] VLESS connection returned null, closing WebSocket');
			safeCloseWebSocket(webSocket);
			return;
		}

		remoteSocket.value = tcpSocket;
		log(`[TCP] Setting up closed handler`);

		tcpSocket.closed.catch((err) => {
			log(`[TCP] tcpSocket.closed catch: ${err?.message || 'unknown'}`);
		}).finally(() => {
			log('[TCP] tcpSocket.closed finally - closing WebSocket');
			safeCloseWebSocket(webSocket);
		});

		log(`[TCP] Calling remoteSocketToWS`);
		remoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, null, log);
	} else {
		// Standard mode: try direct first, then retry with fumidai
		try {
			tcpSocket = await connectDirect(addressRemote, portRemote);
			remoteSocket.value = tcpSocket;
			// Pass retry function - will be called if no incoming data
			remoteSocketToWS(tcpSocket, webSocket, protocolResponseHeader, retry, log);
		} catch (err) {
			log(`[TCP] Direct connection failed: ${err.message}, trying proxies`);
			await retry();
		}
	}
}
