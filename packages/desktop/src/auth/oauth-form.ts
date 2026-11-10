export function postOAuthForm(
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const timeout = AbortSignal.timeout(15000)
  return fetcher(url, {
    body: new URLSearchParams(params),
    method: 'POST',
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
}
