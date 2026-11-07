import InfoPage, { type PageProps } from './InfoPage';
import { INFO_DOCS, type InfoRoute } from './infoPages';

/** One of the pages the site audit found missing, by its route (2026-11-08, batch SJ). Loaded lazily, as each page is. */
export default function InfoRoutePage({ route, ...page }: PageProps & { route: InfoRoute }) {
  return <InfoPage doc={INFO_DOCS[route]()} {...page} />;
}
