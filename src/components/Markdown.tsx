import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The generated specification, rendered, and since 2026-11-05 Forma's replies
 * in the chat (`ChatThread`'s `MessageText`).
 *
 * This exists as its own module so it can be `lazy()`-loaded. `react-markdown`
 * brings the whole micromark tokenizer with it, and both places it is used —
 * the spec plate and a reply — come after the workspace opens. Imported at the
 * top of `App.tsx` it sat in the eager bundle, in front of every visitor to the
 * landing page (audit PERF-001); both call sites lazy-load this one module, so
 * it is one chunk.
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
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: NewTabLink }}>
      {children}
    </ReactMarkdown>
  );
}

/**
 * A link opens in a new tab (2026-11-05, when Forma's chat replies started
 * rendering here too). The workspace is one page holding unsaved work, so a
 * link followed in place would take the report with it. `noopener` keeps the
 * opened page from reaching back into this one. A `javascript:` URL never
 * gets this far: react-markdown's own `urlTransform` empties it.
 */
function NewTabLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
