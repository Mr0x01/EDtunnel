import { DEFAULT_FUMIDAI_PORT } from '../config.js';

/**
 * 解析 URL 路径参数
 */
export function parsePathParams(pathname) {
    const params = {};
    const decodedPathname = decodeURIComponent(pathname);
    const ipMatch = decodedPathname.match(/(?:\/[^\/]*)?\/?ip=([^\/]+)(?:\/|$)/);
    const nat64Match = decodedPathname.match(/(?:\/[^\/]*)?\/?nat64=([^\/]+)(?:\/|$)/);
    const pathMatch = decodedPathname.match(/(?:\/[^\/]*)?\/?path=([^\/]+)(?:\/|$)/);
    const s5Match = decodedPathname.match(/(?:\/[^\/]*)?\/?s5=([^\/]+)(?:\/|$)/);
    const gs5Match = decodedPathname.match(/(?:\/[^\/]*)?\/?gs5=([^\/]+)(?:\/|$)/);
    if (ipMatch) params.ip = decodeURIComponent(ipMatch[1]);
    if (nat64Match) params.nat64 = decodeURIComponent(nat64Match[1]);
    if (pathMatch) params.path = decodeURIComponent(pathMatch[1]);
    if (s5Match) params.s5 = decodeURIComponent(s5Match[1]);
    if (gs5Match) params.gs5 = decodeURIComponent(gs5Match[1]);
    return params;
}

/**
 * 解析代理地址，支持 IPv6 和端口
 */
export function parseFumidaiAddress(address) {
    if (!address) return { address: address, port: DEFAULT_FUMIDAI_PORT };
    if (address.startsWith('[')) {
        const closeBracketIndex = address.indexOf(']');
        if (closeBracketIndex !== -1) {
            const ipv6Part = address.substring(0, closeBracketIndex + 1);
            const remaining = address.substring(closeBracketIndex + 1);
            if (remaining.startsWith(':')) {
                const port = parseInt(remaining.substring(1));
                if (!isNaN(port) && port > 0 && port <= 65535) {
                    return { address: ipv6Part, port: port };
                }
            }
            return { address: ipv6Part, port: DEFAULT_FUMIDAI_PORT };
        }
    }
    const colonIndex = address.lastIndexOf(':');
    if (colonIndex > 0) {
        const addressPart = address.substring(0, colonIndex);
        const portPart = address.substring(colonIndex + 1);
        const port = parseInt(portPart);
        if (!isNaN(port) && port > 0 && port <= 65535) {
            return { address: addressPart, port: port };
        }
    }
    return { address: address, port: DEFAULT_FUMIDAI_PORT };
}

/**
 * 获取代理配置
 */
export function getFumidaiConfiguration(addressRemote, portRemote, Fumidai, FumidaiPort) {
    return { ip: Fumidai || addressRemote, port: FumidaiPort || portRemote };
}
