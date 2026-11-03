/**
 * @param {string} url
 * @returns {Bun.WebSocket}
 */
export function createKickSocket(url) {
  return new WebSocket(url, { headers: { Origin: 'https://kick.com' } })
}
