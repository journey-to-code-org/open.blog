export function pageCount(total, pageSize) {
  if (!Number.isInteger(pageSize) || pageSize < 1) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

export function pageFromSearch(search, pages, parameter) {
  const value = new URLSearchParams(search).get(parameter);
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  return Math.min(Number(value), Math.max(1, pages));
}

export function pageRange(total, pageSize, page) {
  const start = Math.max(0, (page - 1) * pageSize);
  return [start, Math.min(total, start + pageSize)];
}

export function pageHref(href, page, parameter) {
  const url = new URL(href);
  if (page <= 1) url.searchParams.delete(parameter);
  else url.searchParams.set(parameter, String(page));
  return `${url.pathname}${url.search}${url.hash}`;
}
