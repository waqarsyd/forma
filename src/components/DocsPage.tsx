import React, { useState } from 'react';
import { motion, AnimatePresence, useScroll, useSpring } from 'motion/react';
import { transition } from '../lib/motion';
import {
  Search, 
  BookOpen, 
  HelpCircle, 
  Check, 
  ThumbsUp, 
  ThumbsDown,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

interface DocsPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

interface DocSection {
  id: string;
  title: string;
  category: 'guide' | 'schema' | 'control' | 'api';
  keywords: string[];
  content: React.ReactNode;
}

export default function DocsPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode
}: DocsPageProps) {

  // Search and Nav state
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSection, setActiveSection] = useState('getting-started');
  const [searchFocused, setSearchFocused] = useState(false);

  // FAQ Accordion State
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Feedback State
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [isHelpful, setIsHelpful] = useState<boolean | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');

  // Scroll progress bar
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 20 });


  const handleFeedbackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Docs Feedback Submitted:", { isHelpful, comment: feedbackComment });
    setFeedbackSubmitted(true);
  };

  const docSections: DocSection[] = [
    {
      id: "getting-started",
      title: "Getting Started Guide",
      category: "guide",
      keywords: ["start", "ingest", "upload", "repx", "export", "tutorial"],
      content: (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Forma is designed to parse report designs into DevExpress layouts in under a minute. Follow these steps to build your first report schema:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="p-4 bg-surface-container-low border border-outline-variant rounded-2xl">
              <span className="font-mono text-xs text-secondary-container font-bold block mb-1">01. INGEST VISUALS</span>
              <p className="text-xs text-on-surface-variant leading-normal">
                Drag & drop or browse a screenshot of your mockup, wireframe design, or page layout PDF inside the workspace upload panel.
              </p>
            </div>
            <div className="p-4 bg-surface-container-low border border-outline-variant rounded-2xl">
              <span className="font-mono text-xs text-secondary-container font-bold block mb-1">02. DESCRIBE SPECIFICATIONS</span>
              <p className="text-xs text-on-surface-variant leading-normal">
                Use our instruction chat prompt box to tell the parser how to group items, specify paper sizes, colors, or target data fields.
              </p>
            </div>
            <div className="p-4 bg-surface-container-low border border-outline-variant rounded-2xl">
              <span className="font-mono text-xs text-secondary-container font-bold block mb-1">03. INSPECT COORDINATES</span>
              <p className="text-xs text-on-surface-variant leading-normal">
                Toggle the live overview canvas tab to inspect the interactive absolute bounds layout generated dynamically by our Gemini AI.
              </p>
            </div>
            <div className="p-4 bg-surface-container-low border border-outline-variant rounded-2xl">
              <span className="font-mono text-xs text-secondary-container font-bold block mb-1">04. DOWNLOAD REPX XML</span>
              <p className="text-xs text-on-surface-variant leading-normal">
                Once satisfied, click the Export button to save standard validated XML (.REPX) format files, loadable directly inside DevExpress.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "supported-controls",
      title: "Supported Controls & Visual Bounding",
      category: "control",
      keywords: ["label", "table", "image", "barcode", "line", "chart", "gauge", "control", "elements"],
      content: (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            Forma maps layout visual boundaries into specific standard DevExpress Control tags. These are automatically packaged within serialized structures:
          </p>
          <div className="space-y-3">
            <div className="flex items-start gap-3 border-b border-outline-variant pb-3">
              <span className="font-mono text-xs bg-surface-container text-foreground px-2 py-0.5 rounded font-bold">XRLabel</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Extracted for standard headings, text paragraphs, invoice titles, and tabular values. Includes dynamic settings for font size, weight, text alignment, and foreground color specifications.
              </p>
            </div>
            <div className="flex items-start gap-3 border-b border-outline-variant pb-3">
              <span className="font-mono text-xs bg-surface-container text-foreground px-2 py-0.5 rounded font-bold">XRPictureBox</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Constructed for logos, graphical placeholders, employee photo slots, and watermark items. Mapped cleanly with boundary dimensions.
              </p>
            </div>
            <div className="flex items-start gap-3 border-b border-outline-variant pb-3">
              <span className="font-mono text-xs bg-surface-container text-foreground px-2 py-0.5 rounded font-bold">XRTable</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Created to represent multi-column pricing structures, tabular diagnostic listings, or invoice descriptions. Parsed dynamically as cell elements.
              </p>
            </div>
            <div className="flex items-start gap-3 border-b border-outline-variant pb-3">
              <span className="font-mono text-xs bg-surface-container text-foreground px-2 py-0.5 rounded font-bold">XRBarCode</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Generated for Employee ID barcodes, tracking labels, or SKU identifiers. Encodes textual keys automatically into visual scannable bar codes.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs bg-surface-container text-foreground px-2 py-0.5 rounded font-bold">XRLine</span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Represent horizontal or vertical border grids, summary headers, and invoice dividers. Drawn with precise pixel locations.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "repx-schema",
      title: "DevExpress REPX XML Serialization",
      category: "schema",
      keywords: ["xml", "schema", "repx", "serializer", "band", "detail", "width", "height"],
      content: (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            All designs are compiled into standard DevExpress REPX XML schema structure, representing serializations that look like the snippet below:
          </p>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] text-slate-300 overflow-x-auto">
            <pre>{`<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="23.2.3.0" Ref="0" 
  ControlType="DevExpress.XtraReports.UI.XtraReport" 
  Name="FormaReport" PageWidth="850" PageHeight="1100" 
  ReportUnit="HundredthsOfAnInch" Margins="100, 100, 100, 100">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="100" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="280">
      <Controls>
        <Item1 Ref="3" ControlType="XRLabel" Name="TitleText" 
          Text="COMMERCIAL INVOICE" LocationFloat="20,10" SizeF="400,30" />
      </Controls>
    </Item2>
    <Item3 Ref="4" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="100" />
  </Bands>
</XtraReportsLayoutSerializer>`}</pre>
          </div>
          <p className="text-xs text-outline leading-normal italic">
            Note: Ensure your targeted Version matching in the Configure modal matches your installed DevExpress SDK version (e.g. v23.2, v24.1) for zero compatibility issues.
          </p>
        </div>
      )
    },
    {
      id: "api-config",
      title: "Custom Gemini API Configuration",
      category: "api",
      keywords: ["api", "key", "gemini", "limits", "quota", "studio", "key", "configure"],
      content: (
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant leading-relaxed">
            By default, Forma operates using a shared developers API key. To bypass daily limits and ensure maximum performance under heavy testing, configure a custom key:
          </p>
          <ol className="list-decimal pl-5 space-y-2 text-xs text-on-surface-variant leading-relaxed">
            <li>Go to <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="text-secondary-container hover:underline font-bold">Google AI Studio</a>.</li>
            <li>Log in and click on <strong>Get API Key</strong>.</li>
            <li>Generate a new API key for free.</li>
            <li>In the Forma Workspace header panel, click <strong>Configure</strong>.</li>
            <li>Paste your key under the <strong>Custom API Key</strong> field and click <strong>Save Changes</strong>.</li>
          </ol>
          <div className="p-4 bg-secondary-container/10 border border-secondary-container/30 rounded-2xl flex items-start gap-3 mt-4 text-[11px] text-on-surface-variant leading-relaxed font-sans">
            <AlertCircle size={16} className="shrink-0 text-orange-600 mt-0.5" />
            <p>
              Your custom API key is stored securely within your browser's local state (`localStorage`) and is sent directly to Google Gemini servers. It is never transmitted to, or stored on, any other external database.
            </p>
          </div>
        </div>
      )
    }
  ];

  // Filter sections by search query
  const filteredSections = docSections.filter(sec => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      sec.title.toLowerCase().includes(q) ||
      sec.keywords.some(k => k.includes(q)) ||
      sec.category.toLowerCase().includes(q)
    );
  });

  const faqs = [
    {
      q: "What file formats does the parser upload support?",
      a: "Forma currently parses image files (PNG, JPG, WebP), vector documents (PDF), and pre-built DevExpress layout files (.REPX)."
    },
    {
      q: "Can I load the generated REPX files directly in my Visual Studio layout designer?",
      a: "Yes. The generated REPX files are fully conformant XML specifications. You can import them directly into Visual Studio's DevExpress designer or DevExpress end-user designer wrappers."
    },
    {
      q: "Why does the parser fail to parse complex grid structures?",
      a: "Ensure the mockup image is clean, high contrast, and text boundaries are clearly legible. For nested tables, you can explicitly prompt the assistant to group the boundaries together as XRTable structures."
    },
    {
      q: "Is there a charge to get a custom Gemini API Key?",
      a: "No, Google AI Studio offers free-tier API keys with generous request limits per minute, which are ideal for layout parsing tasks."
    }
  ];

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col">
      {/* Scroll Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-secondary-container via-amber-400 to-secondary-container origin-left z-[200] pointer-events-none"
        style={{ scaleX }}
      />
      <SiteHeader
        active="Docs"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
      {/* Docs Body Frame */}
      <main className="flex-grow max-w-container-max mx-auto px-margin-desktop py-12 w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative overflow-hidden">
        {/* Left navigation menu panel with motion reveal */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="lg:col-span-3 lg:sticky lg:top-24 space-y-4"
        >
          <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-3xl p-5 shadow-sm space-y-4 text-left">
            <h3 className="font-bold text-sm text-on-surface flex items-center gap-2 px-1">
              <BookOpen size={16} className="text-secondary-container" /> Documentation
            </h3>
            
            <div className="space-y-1">
              {docSections.map((sec, idx) => (
                <motion.button
                  key={sec.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: idx * 0.05, ease: 'easeOut' }}
                  whileHover={{ x: 3 }}
                  onClick={() => {
                    setActiveSection(sec.id);
                    const el = document.getElementById(sec.id);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between cursor-pointer ${
                    activeSection === sec.id
                      ? "bg-secondary-container/10 text-secondary-container font-bold"
                      : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                  }`}
                >
                  {sec.title}
                  {activeSection === sec.id && (
                    <motion.div layoutId="nav-indicator" className="w-1.5 h-1.5 rounded-full bg-secondary-container" />
                  )}
                </motion.button>
              ))}
            </div>

            <div className="h-px bg-surface-container"></div>

            <button
              onClick={() => {
                setActiveSection('faq-section');
                const el = document.getElementById('faq-section');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center justify-between cursor-pointer ${
                activeSection === 'faq-section'
                  ? "bg-secondary-container/10 text-secondary-container font-bold"
                  : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
              }`}
            >
              FAQ Section
            </button>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-3xl p-5 shadow-sm space-y-4 text-left">
            <h4 className="font-bold text-xs text-on-surface uppercase tracking-wider font-mono">Quick sandbox</h4>
            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Have report layouts ready for ingestion? Open our workspace interface to generate code specifications.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={onEnterWorkspace}
              className="w-full bg-secondary-container hover:bg-[#e05a00] text-white py-2.5 rounded-xl font-label-caps text-[10px] uppercase font-bold tracking-wider transition-colors cursor-pointer flex items-center justify-center gap-1 shadow-sm"
            >
              Go to Workspace <ArrowRight size={12} />
            </motion.button>
          </div>
        </motion.aside>

        {/* Right docs content: 9 columns */}
        <section className="lg:col-span-9 space-y-8">
          {/* Instant Search Bar. Framer owns the entrance only; the focus ring is
              CSS so it follows the theme tokens — animating borderColor/boxShadow
              here wrote inline light-mode literals that outranked every dark: rule. */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transition.base}
            className={`u-transition bg-surface-container-lowest border rounded-3xl p-4 flex items-center gap-3 ${
              searchFocused
                ? 'border-secondary-container ring-4 ring-secondary-container/15 shadow-sm'
                : 'border-outline-variant/40 shadow-sm'
            }`}
          >
            <Search size={18} className={`u-transition ${searchFocused ? 'text-secondary-container' : 'text-outline'}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search documentation sections (e.g. repx, controls, key)..."
              className="bg-transparent border-none focus:ring-0 text-xs w-full py-1 text-on-surface placeholder-on-surface-variant/50 outline-none font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[10px] font-mono text-outline hover:text-on-surface font-bold uppercase cursor-pointer"
              >
                Clear
              </button>
            )}
          </motion.div>

          {/* Main filtered content readouts */}
          <div className="space-y-8">
            {filteredSections.length === 0 ? (
              <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-3xl p-12 text-center text-on-surface-variant space-y-3">
                <HelpCircle size={40} className="mx-auto text-slate-400" />
                <p className="text-sm">No documentation sections match your search queries.</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-xs text-secondary-container font-bold hover:underline cursor-pointer"
                >
                  Clear search filters
                </button>
              </div>
            ) : (
              filteredSections.map((sec, i) => (
                <motion.article
                  key={sec.id}
                  id={sec.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className="bg-surface-container-lowest border border-outline-variant/40 rounded-3xl p-8 md:p-10 shadow-sm scroll-mt-24 transition-shadow hover:shadow-md text-left"
                >
                  <span className="text-[10px] font-bold tracking-widest text-secondary-container uppercase font-mono mb-2 block">
                    {sec.category} SPEC
                  </span>
                  <h2 className="text-xl md:text-2xl font-bold text-on-surface mb-4 tracking-tight">
                    {sec.title}
                  </h2>
                  <div className="h-px bg-surface-container mb-6"></div>
                  <div className="font-sans text-sm text-on-surface-variant leading-relaxed">
                    {sec.content}
                  </div>
                </motion.article>
              ))
            )}

            {/* Accordion FAQ section with Motion */}
            {(!searchQuery || 'faq'.includes(searchQuery.toLowerCase())) && (
              <motion.article
                id="faq-section"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="bg-surface-container-lowest border border-outline-variant/40 rounded-3xl p-8 md:p-10 shadow-sm scroll-mt-24 text-left"
              >
                <span className="text-[10px] font-bold tracking-widest text-secondary-container uppercase font-mono mb-2 block">
                  FAQ SUPPORT
                </span>
                <h2 className="text-xl md:text-2xl font-bold text-on-surface mb-4 tracking-tight">
                  Frequently Asked Questions
                </h2>
                <div className="h-px bg-surface-container mb-6"></div>

                <div className="space-y-3">
                  {faqs.map((faq, index) => (
                    <div key={index} className="border border-outline-variant rounded-2xl overflow-hidden bg-surface-container-low/50">
                      <button
                        onClick={() => setOpenFaq(openFaq === index ? null : index)}
                        className="w-full text-left p-4.5 font-bold text-xs md:text-sm text-on-surface flex justify-between items-center hover:bg-surface-container-low transition-colors cursor-pointer select-none"
                      >
                        <span>{faq.q}</span>
                        {openFaq === index ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <AnimatePresence>
                        {openFaq === index && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="overflow-hidden"
                          >
                            <div className="px-4.5 pb-4.5 text-xs text-on-surface-variant leading-relaxed font-sans border-t border-outline-variant/50 pt-2.5">
                              {faq.a}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))}
                </div>
              </motion.article>
            )}

            {/* Interactive help feedback form widget.
                Surface is primary-container, not foreground: --foreground flips to
                near-white in dark mode, which put white text on a white card. */}
            <motion.article
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="bg-primary-container text-white rounded-3xl p-8 md:p-10 text-left shadow-sm"
            >
              <span className="text-[10px] font-bold tracking-widest text-secondary-container uppercase font-mono mb-2 block">
                DOCS IMPROVEMENT
              </span>
              <h2 className="text-xl md:text-2xl font-bold text-white mb-2 tracking-tight">
                Was this documentation helpful?
              </h2>
              <p className="text-slate-400 text-xs leading-normal mb-6">
                Your feedback helps us continuously update layouts, schemas, and developer specs logs.
              </p>

              {feedbackSubmitted ? (
                <div className="p-6 bg-slate-800/80 border border-slate-700 rounded-2xl flex flex-col items-center gap-3 text-center py-8">
                  <div className="w-10 h-10 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full flex items-center justify-center">
                    <Check size={18} />
                  </div>
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-200">Feedback Submitted</h4>
                  <p className="text-xs text-slate-400 max-w-xs leading-relaxed font-sans">
                    Thank you! Your feedback has been logged to improve our documentation libraries.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => {
                        setIsHelpful(true);
                        setFeedbackComment('');
                      }}
                      className={`flex-1 py-3 px-4 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold font-mono transition-all cursor-pointer ${
                        isHelpful === true
                          ? "bg-secondary-container border-secondary-container text-white shadow-md"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <ThumbsUp size={14} /> YES
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsHelpful(false)}
                      className={`flex-1 py-3 px-4 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold font-mono transition-all cursor-pointer ${
                        isHelpful === false
                          ? "bg-red-500 border-red-500 text-white shadow-md"
                          : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                    >
                      <ThumbsDown size={14} /> NO
                    </button>
                  </div>

                  {isHelpful === false && (
                    <div className="space-y-2 pt-2 text-left">
                      <label className="block text-[10px] font-mono text-slate-400 font-bold uppercase tracking-wider">
                        Tell us how we can improve this document:
                      </label>
                      <textarea
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                        placeholder="e.g. Needs more detailed REPX XML node documentation..."
                        required
                        className="w-full min-h-[80px] p-3.5 border border-slate-800 rounded-xl text-xs text-white bg-slate-900 focus:outline-none focus:border-secondary-container transition-colors resize-none font-sans"
                      />
                    </div>
                  )}

                  {isHelpful !== null && (
                    <div className="pt-2 flex justify-end">
                      <button
                        type="submit"
                        className="bg-surface-container-lowest hover:bg-surface-container text-slate-950 px-6 py-2.5 rounded-xl font-label-caps text-[10px] uppercase font-bold tracking-wider transition-all cursor-pointer"
                      >
                        Submit Feedback
                      </button>
                    </div>
                  )}
                </form>
              )}
            </motion.article>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
