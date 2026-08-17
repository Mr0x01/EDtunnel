import { connect } from 'cloudflare:sockets';

/**
 * 解析 SOCKS5 地址格式
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
    return { username, password, hostname, port };
}

/**
 * 建立 SOCKS5 代理连接
 */
export async function socks5Connect(addressType, addressRemote, portRemote, socks5Address) {
    const { username, password, hostname, port } = socks5Address;
    const socket = connect({ hostname, port });
    const socksGreeting = new Uint8Array([5, 2, 0, 2]);
    const writer = socket.writable.getWriter();
    await writer.write(socksGreeting);
    const reader = socket.readable.getReader();
    const encoder = new TextEncoder();
    let res = (await reader.read()).value;
    if (res[0] !== 0x05) {
        throw new Error(`socks server version error: ${res[0]} expected: 5`);
    }
    if (res[1] === 0xff) {
        throw new Error("no acceptable methods");
    }
    if (res[1] === 0x02) {
        if (!username || !password) {
            throw new Error("please provide username/password");
        }
        const authRequest = new Uint8Array([
            1,
            username.length,
            ...encoder.encode(username),
            password.length,
            ...encoder.encode(password)
        ]);
        await writer.write(authRequest);
        res = (await reader.read()).value;
        if (res[0] !== 0x01 || res[1] !== 0x00) {
            throw new Error("fail to auth socks server");
        }
    }
    let DSTADDR;
    switch (addressType) {
        case 1: // IPv4
            DSTADDR = new Uint8Array([1, ...addressRemote.split('.').map(Number)]);
            break;
        case 2: // 域名
            DSTADDR = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)]);
            break;
        case 3: // IPv6
            DSTADDR = new Uint8Array([4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])]);
            break;
        default:
            throw new Error(`invalid addressType is ${addressType}`);
    }
    const socksRequest = new Uint8Array([5, 1, 0, ...DSTADDR, portRemote >> 8, portRemote & 0xff]);
    await writer.write(socksRequest);
    res = (await reader.read()).value;
    if (res[1] !== 0x00) {
        throw new Error("fail to open socks connection");
    }
    writer.releaseLock();
    reader.releaseLock();
    return socket;
}
