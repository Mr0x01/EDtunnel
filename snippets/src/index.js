import { parsePathParams, parseFumidaiAddress } from './utils/parser.js';
import { socks5AddressParser } from './fumidai/socks5.js';
import { handleVLESSWebSocket } from './stream/websocket.js';
import { DEFAULT_FUMIDAI_PORT } from './config.js';

export default {
    async fetch(request) {
        try {
            const url = new URL(request.url);
            let parsedSocks5Address = {};
            let enableSocks = false;
            let enableGlobalSocks = false;
            let Fumidai = '';
            let FumidaiPort = DEFAULT_FUMIDAI_PORT;

            const pathParams = parsePathParams(url.pathname);
            const ipParam = url.searchParams.get('ip') || pathParams.ip;
            if (ipParam) {
                const parsed = parseFumidaiAddress(ipParam);
                Fumidai = parsed.address;
                FumidaiPort = parsed.port;
            }

            const s5Param = pathParams.s5 || url.searchParams.get('s5');
            const gs5Param = pathParams.gs5 || url.searchParams.get('gs5');

            if (s5Param) {
                try {
                    parsedSocks5Address = socks5AddressParser(s5Param);
                    enableSocks = true;
                } catch (err) {
                    enableSocks = false;
                }
            }

            if (gs5Param) {
                try {
                    parsedSocks5Address = socks5AddressParser(gs5Param);
                    enableGlobalSocks = true;
                } catch (err) {
                    enableGlobalSocks = false;
                }
            }

            // 检查是否为 WebSocket 升级请求
            const upgradeHeader = request.headers.get('Upgrade');
            if (upgradeHeader !== 'websocket') {
                return new Response('', { status: 400 });
            }

            return await handleVLESSWebSocket(request, {
                parsedSocks5Address,
                enableSocks,
                enableGlobalSocks,
                Fumidai,
                FumidaiPort
            });
        } catch (err) {
            return new Response(err && err.stack ? err.stack : String(err), { status: 500 });
        }
    },
};
