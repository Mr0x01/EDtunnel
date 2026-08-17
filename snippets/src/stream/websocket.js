import { connect } from 'cloudflare:sockets';
import { WS_READY_STATE_OPEN } from '../config.js';
import { parseVLESSHeader } from '../protocol/vless.js';
import { socks5Connect } from '../fumidai/socks5.js';
import { handleUDPOutBound } from '../fumidai/dns.js';
import { pipeRemoteToWebSocket, closeSocket } from '../fumidai/tcp.js';
import { getFumidaiConfiguration } from '../utils/parser.js';

/**
 * 创建 WebSocket 可读流
 */
export function createWebSocketReadableStream(ws, earlyDataHeader) {
    return new ReadableStream({
        start(controller) {
            ws.addEventListener('message', event => {
                controller.enqueue(event.data);
            });
            ws.addEventListener('close', () => {
                controller.close();
            });
            ws.addEventListener('error', err => {
                controller.error(err);
            });
            if (earlyDataHeader) {
                try {
                    const decoded = atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/'));
                    const data = Uint8Array.from(decoded, c => c.charCodeAt(0));
                    controller.enqueue(data.buffer);
                } catch (e) {}
            }
        }
    });
}

/**
 * 处理 VLESS WebSocket 连接
 */
export async function handleVLESSWebSocket(request, config) {
    const { parsedSocks5Address, enableSocks, enableGlobalSocks, Fumidai, FumidaiPort } = config;
    const wsPair = new WebSocketPair();
    const [clientWS, serverWS] = Object.values(wsPair);

    serverWS.accept();

    // WebSocket 心跳机制
    let heartbeatInterval = setInterval(() => {
        if (serverWS.readyState === WS_READY_STATE_OPEN) {
            try { serverWS.send('ping'); } catch (e) {}
        }
    }, 10000);
    function clearHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
    serverWS.addEventListener('close', clearHeartbeat);
    serverWS.addEventListener('error', clearHeartbeat);

    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
    const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader);
    let remoteSocket = null;
    let udpStreamWrite = null;
    let isDns = false;

    wsReadable.pipeTo(new WritableStream({
        async write(chunk) {
            if (isDns && udpStreamWrite) {
                return udpStreamWrite(chunk);
            }
            if (remoteSocket) {
                try {
                    const writer = remoteSocket.writable.getWriter();
                    await writer.write(chunk);
                    writer.releaseLock();
                } catch (err) {
                    closeSocket(remoteSocket);
                    throw err;
                }
                return;
            }
            const result = parseVLESSHeader(chunk);
            if (result.hasError) {
                throw new Error(result.message);
            }
            const vlessRespHeader = new Uint8Array([result.vlessVersion[0], 0]);
            const rawClientData = chunk.slice(result.rawDataIndex);

            if (result.isUDP) {
                if (result.portRemote === 53) {
                    isDns = true;
                    const { write } = await handleUDPOutBound(serverWS, vlessRespHeader);
                    udpStreamWrite = write;
                    udpStreamWrite(rawClientData);
                    return;
                } else {
                    throw new Error('UDP代理仅支持DNS(端口53)');
                }
            }

            async function connectAndWrite(address, port) {
                const tcpSocket = await connect({ hostname: address, port: port }, { allowHalfOpen: true });
                remoteSocket = tcpSocket;
                const writer = tcpSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                return tcpSocket;
            }

            async function connectAndWriteSocks(address, port) {
                const tcpSocket = await socks5Connect(result.addressType, address, port, parsedSocks5Address);
                remoteSocket = tcpSocket;
                const writer = tcpSocket.writable.getWriter();
                await writer.write(rawClientData);
                writer.releaseLock();
                return tcpSocket;
            }

            async function retry() {
                try {
                    let tcpSocket;
                    if (enableSocks) {
                        tcpSocket = await socks5Connect(result.addressType, result.addressRemote, result.portRemote, parsedSocks5Address);
                    } else {
                        const fumidaiConfig = getFumidaiConfiguration(result.addressRemote, result.portRemote, Fumidai, FumidaiPort);
                        tcpSocket = await connect({ hostname: fumidaiConfig.ip, port: fumidaiConfig.port }, { allowHalfOpen: true });
                    }
                    remoteSocket = tcpSocket;
                    const writer = tcpSocket.writable.getWriter();
                    await writer.write(rawClientData);
                    writer.releaseLock();
                    tcpSocket.closed.catch(() => {}).finally(() => {
                        if (serverWS.readyState === WS_READY_STATE_OPEN) {
                            serverWS.close(1000, '连接已关闭');
                        }
                    });
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, null);
                } catch (err) {
                    closeSocket(remoteSocket);
                    serverWS.close(1011, '代理连接失败: ' + (err && err.message ? err.message : err));
                }
            }

            try {
                if (enableGlobalSocks) {
                    const tcpSocket = await connectAndWriteSocks(result.addressRemote, result.portRemote);
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
                } else {
                    const tcpSocket = await connectAndWrite(result.addressRemote, result.portRemote);
                    pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry);
                }
            } catch (err) {
                closeSocket(remoteSocket);
                serverWS.close(1011, '连接失败: ' + (err && err.message ? err.message : err));
            }
        },
        close() {
            if (remoteSocket) {
                closeSocket(remoteSocket);
            }
        }
    })).catch(err => {
        closeSocket(remoteSocket);
        serverWS.close(1011, '内部错误: ' + (err && err.message ? err.message : err));
    });

    return new Response(null, {
        status: 101,
        webSocket: clientWS,
    });
}
