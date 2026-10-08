// A non-HttpOnly UI hint that a session cookie probably exists. The real session cookie is
// HttpOnly and cannot be read from JS, so this is only used to skip a pointless /api/me call on the
// landing page. It grants nothing: the server still checks the real session on every request.
const NAME = 'coach_signed_in'

export function hasSessionHint(): boolean {
  return document.cookie.split(';').some((c) => c.trim() === `${NAME}=1`)
}

export function setSessionHint(on: boolean): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  if (on) document.cookie = `${NAME}=1; Path=/; SameSite=Lax; Max-Age=2592000${secure}`
  else document.cookie = `${NAME}=; Path=/; SameSite=Lax; Max-Age=0${secure}`
}
