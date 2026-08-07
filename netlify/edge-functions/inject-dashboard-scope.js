export default async function injectDashboardScope(request, context) {
  const response = await context.next();

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return response;

  let html = await response.text();
  if (html.includes('id="sbc-customer-scope-direct"')) {
    return new Response(html, response);
  }

  const script = '<script id="sbc-customer-scope-direct" src="/js/customer-scope-control.js?v=direct-20260806-3"></script>';
  if (html.includes("</body>")) html = html.replace("</body>", script + "</body>");
  else html += script;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.delete("content-length");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
