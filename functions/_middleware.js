export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  
  if (url.hostname.endsWith('.pages.dev')) {
    // Clone headers since response headers are read-only
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-Robots-Tag', 'noindex, nofollow');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
  
  return response;
}
