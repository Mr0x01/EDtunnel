/**
 * HTTP response handlers
 */

/**
 * Escapes values before inserting them into the response HTML.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
	return String(value ?? '未知')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Handles default path requests when no specific route matches.
 * Returns a basic visitor information page.
 * @param {URL} url - The URL object of the request
 * @param {Request} request - The incoming request object
 * @returns {Response} HTML response with visitor information
 */
export async function handleDefaultPath(url, request) {
	const cf = request.cf || {};
	const visitorInfo = [
		['主机', request.headers.get('Host')],
		['IP 地址', request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')],
		['请求方法', request.method],
		['请求路径', url.pathname],
		['User-Agent', request.headers.get('User-Agent')],
		['语言', request.headers.get('Accept-Language')],
		['来源页面', request.headers.get('Referer')],
		['国家/地区', cf.country],
		['城市', cf.city],
		['区域', cf.region],
		['时区', cf.timezone],
		['ASN', cf.asn],
	].map(([label, value]) => `
					<dt>${escapeHtml(label)}</dt>
					<dd>${escapeHtml(value)}</dd>`).join('');

	const visitorPage = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8">
	<title>访问者信息</title>
</head>
<body>
	<h1>访问者基本信息</h1>
	<dl>${visitorInfo}
	</dl>
</body>
</html>`;

	return new Response(visitorPage, {
		headers: {
			'content-type': 'text/html;charset=UTF-8',
		},
	});
}
