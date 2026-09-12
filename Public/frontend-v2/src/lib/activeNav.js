
export function normalizePath(p) {
  const path = p || '/';
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

export function isActivePath(current, href) {
  return normalizePath(current) === normalizePath(href);
}
