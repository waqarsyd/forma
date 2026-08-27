import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The generated specification, rendered.
 *
 * This exists as its own module so it can be `lazy()`-loaded. `react-markdown`
 * brings the whole micromark tokenizer with it, and it is used in exactly one
 * place — the spec plate in the workspace, which nobody reaches without first
 * generating a report. Imported at the top of `App.tsx` it sat in the eager
 * bundle, in front of every visitor to the landing page (audit PERF-001).
 *
 * The plugin has to come along for the ride, which is the reason this is a
 * component rather than a bare `lazy(() => import('react-markdown'))`:
 * `remarkGfm` is a plugin, not a component, and a static import of it would
 * pull micromark back into the eager chunk on its own.
 *
 * **No `rehype-raw`, deliberately.** This renders model output, and
 * `react-markdown` escapes raw HTML unless that plugin is added. That escaping
 * is the app's XSS defence on generated content — there is no CSP behind it
 * yet — so adding it here would be the single most dangerous line in the
 * project. See `audit/05a-security.md`.
 */
export default function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>;
}
