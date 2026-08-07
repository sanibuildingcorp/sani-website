export default async (request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) return response;

  const url = new URL(request.url);
  if (url.pathname !== "/dashboard" && url.pathname !== "/dashboard.html") {
    return response;
  }

  let html = await response.text();
  const marker = "/js/customer-scope-control.js";
  if (!html.includes(marker)) {
    const tag = '<script src="/js/customer-scope-control.js?v=3"></script>';
    html = html.includes("</body>")
      ? html.replace("</body>", `${tag}\n</body>`)
      : html + tag;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("x-sbc-dashboard-scope", "v3");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
