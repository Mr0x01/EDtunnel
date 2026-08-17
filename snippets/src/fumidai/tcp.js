import { WS_READY_STATE_OPEN } from '../config.js';

/**
 * 关闭 socket 连接
 */
export function closeSocket(socket) {
    if (socket) {
        try {
            socket.close();
        } catch (e) {}
    }
}

/**
 * 将远程 socket 数据转发到 WebSocket
 */
export function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader, retry = null) {
    let headerSent = false;
    let hasIncomingData = false;

    remoteSocket.readable.pipeTo(new WritableStream({
        write(chunk) {
            hasIncomingData = true;
            if (ws.readyState === WS_READY_STATE_OPEN) {
                if (!headerSent) {
                    const combined = new Uint8Array(vlessHeader.byteLength + chunk.byteLength);
                    combined.set(new Uint8Array(vlessHeader), 0);
                    combined.set(new Uint8Array(chunk), vlessHeader.byteLength);
                    ws.send(combined.buffer);
                    headerSent = true;
                } else {
                    ws.send(chunk);
                }
            }
        },
        close() {
            if (!hasIncomingData && retry) {
                retry();
                return;
            }
            if (ws.readyState === WS_READY_STATE_OPEN) {
                ws.close(1000, '正常关闭');
            }
        },
        abort() {
            closeSocket(remoteSocket);
        }
    })).catch(() => {
        closeSocket(remoteSocket);
        if (ws.readyState === WS_READY_STATE_OPEN) {
            ws.close(1011, '数据传输错误');
        }
    });
}
