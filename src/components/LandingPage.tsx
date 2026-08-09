import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import Logo from './Logo';
import UserAvatar from './UserAvatar';
import MobileNav from './MobileNav';

/**
 * The marketing home page.
 *
 * Extracted from App.tsx, where it had been defined inline alongside the
 * workspace. It is a sibling of FeaturesPage / DocsPage / ContactPage and takes
 * the same props, so the four marketing surfaces now live together in
 * src/components/ and share one shape.
 *
 * Its header is the same pattern as theirs: the tagline is hidden below lg and
 * the auth controls move into MobileNav below md, because at phone widths the
 * full set does not fit and used to overlap.
 */
const LandingPage = ({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode,
}: {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}) => {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="font-body-lg text-body-lg bg-surface text-on-surface min-h-screen flex flex-col">
      {/* TopNavBar */}
      <header className="w-full sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant">
        <nav className="flex justify-between items-center px-margin-desktop py-4 max-w-container-max mx-auto">
          <div className="flex items-center gap-4">
            <Logo size={32} />
            <div className="flex flex-col">
              <span className="font-display-lg text-title-md font-bold text-primary">Forma</span>
              <span className="font-label-caps text-[10px] tracking-widest text-on-surface-variant uppercase hidden lg:block">Show it. Build it. Ship it.</span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a className="text-secondary font-bold border-b-2 border-secondary pb-1 font-title-md text-body-sm transition-colors duration-200" href="#">Product</a>
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="#features">Features</a>
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="#docs">Docs</a>
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="#contact">Contact</a>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <MobileNav active="Product" signedIn={!!user} />
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-10 h-10 flex items-center justify-center rounded-full border border-outline-variant hover:bg-secondary/10 hover:border-secondary text-on-surface-variant hover:text-secondary transition-all active:scale-95 cursor-pointer mr-1 select-none"
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              <span className="material-symbols-outlined text-[20px]">
                {isDarkMode ? 'light_mode' : 'dark_mode'}
              </span>
            </button>
            {user ? (
              <div className="flex items-center gap-4 relative" ref={profileMenuRef}>
                <div
                  onClick={() => setShowProfileMenu(!showProfileMenu)}
                  className="flex items-center gap-2.5 px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 rounded-full select-none cursor-pointer transition-colors"
                >
                  <UserAvatar user={user} />
                  <span className="font-label-caps text-[11px] text-on-surface-variant font-semibold hidden lg:inline max-w-[120px] truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  <span className="hidden lg:inline"><span className="material-symbols-outlined text-[16px] text-on-surface-variant select-none">
                    {showProfileMenu ? 'expand_less' : 'expand_more'}
                  </span></span>
                </div>
                <button
                  onClick={onEnterWorkspace}
                  className="hidden lg:inline-block whitespace-nowrap font-label-caps text-on-surface-variant text-body-sm px-4 py-2 hover:text-secondary hover:bg-surface-container-low rounded-full transition-all active:scale-95 cursor-pointer"
                >
                  Workspace
                </button>

                {showProfileMenu && (
                  <div className="absolute right-0 top-full mt-2 w-56 bg-surface-container-lowest dark:bg-card border border-outline-variant rounded-2xl shadow-2xl z-50 overflow-hidden py-2">
                    <div className="px-4 py-3 border-b border-outline-variant/30 flex flex-col text-left">
                      <span className="text-xs font-bold text-on-surface truncate">
                        {user.displayName || 'Developer User'}
                      </span>
                      <span className="text-[10px] text-on-surface-variant truncate font-mono mt-0.5">
                        {user.email || 'developer@example.com'}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setShowProfileMenu(false);
                        logOut();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-error-container text-error hover:text-error transition-colors text-left text-xs font-semibold font-label-caps cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">logout</span>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <button
                  onClick={onSignIn}
                  className="whitespace-nowrap font-label-caps text-on-surface-variant px-4 py-2 hover:text-secondary transition-colors transition-transform active:scale-95 cursor-pointer"
                >
                  Sign In
                </button>
                <button
                  onClick={onSignUp}
                  className="whitespace-nowrap bg-secondary-container text-white px-4 sm:px-6 py-2 font-label-caps transition-all hover:bg-secondary active:scale-95 rounded-full shadow-lg shadow-secondary-container/20 cursor-pointer"
                >
                  Sign Up
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>
      <main className="flex-grow">
        {/* Compact Hero Section */}
        <section className="relative pt-24 pb-36 hero-gradient overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] opacity-50"></div>
          <div className="max-w-container-max mx-auto px-margin-desktop text-center">

            <h1 className="font-display-lg text-display-lg md:text-[64px] font-bold mb-8 tracking-tight text-on-surface leading-tight">
              Show it. Build it. <span className="text-secondary">Ship it.</span>
            </h1>
            <p className="font-body-lg text-body-lg md:text-xl text-on-surface-variant max-w-3xl mx-auto mb-12 leading-relaxed">
              An intelligent workspace designed to turn loose ideas and sketches into high-fidelity DevExpress layouts and report design specs instantly.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={onEnterWorkspace}
                className="bg-secondary-container text-white px-10 py-4 font-label-caps transition-all hover:bg-secondary active:scale-95 rounded-full shadow-xl shadow-secondary-container/25 text-body-lg cursor-pointer"
              >
                Get Started Now
              </button>
              <a
                href="#docs"
                className="border border-outline-variant text-on-surface px-8 py-4 font-label-caps transition-all hover:bg-black hover:text-white active:scale-95 rounded-full flex items-center justify-center gap-2 cursor-pointer text-sm font-semibold"
              //className="border border-black text-on-surface px-8 py-4 font-label-caps transition-all hover:bg-black hover:text-white active:scale-95 rounded-full flex items-center justify-center gap-2 cursor-pointer"
              >
                View Documentation <span className="material-symbols-outlined text-[18px]">menu_book</span>
              </a>
            </div>
          </div>
        </section>

        {/* Feature-First Workflow Overlap */}
        <section className="relative -mt-20 z-10 px-margin-desktop pb-32">
          <div className="max-w-container-max mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
              {/* Feature 1: Show it */}
              <div className="bg-surface-container-lowest border border-outline-variant p-10 relative hover:border-secondary transition-all group duration-500 rounded-3xl shadow-lg hover:shadow-2xl">
                <div className="absolute top-8 right-8 port-indicator"></div>
                <div className="mb-8 w-14 h-14 bg-secondary-fixed flex items-center justify-center rounded-2xl">
                  <span className="material-symbols-outlined text-secondary text-3xl" style={{ fontVariationSettings: '"FILL" 1' }}>upload_file</span>
                </div>
                <span className="font-code-sm text-secondary mb-3 block tracking-widest">01 SHOW IT</span>
                <h3 className="font-title-md text-headline-lg-mobile mb-4 text-on-surface">Visual Ingestion</h3>
                <p className="font-body-sm text-body-lg text-on-surface-variant">
                  Upload images, sketches, or PDFs. Our engine handles multi-format ingestion with pixel-perfect resolution.
                </p>
              </div>

              {/* Feature 2: Build it */}
              <div className="bg-surface-container-lowest border border-outline-variant p-10 relative hover:border-secondary transition-all group duration-500 rounded-3xl shadow-lg hover:shadow-2xl">
                <div className="absolute top-8 right-8 port-indicator"></div>
                <div className="mb-8 w-14 h-14 bg-secondary-fixed flex items-center justify-center rounded-2xl">
                  <span className="material-symbols-outlined text-secondary text-3xl" style={{ fontVariationSettings: '"FILL" 1' }}>auto_awesome</span>
                </div>
                <span className="font-code-sm text-secondary mb-3 block tracking-widest">02 BUILD IT</span>
                <h3 className="font-title-md text-headline-lg-mobile mb-4 text-on-surface">Structural Parsing</h3>
                <p className="font-body-sm text-body-lg text-on-surface-variant">
                  AI parses inputs, calculates metrics, and generates interactive code with specifications using proprietary algorithms.
                </p>
              </div>

              {/* Feature 3: Ship it */}
              <div className="bg-surface-container-lowest border border-outline-variant p-10 relative hover:border-secondary transition-all group duration-500 rounded-3xl shadow-lg hover:shadow-2xl">
                <div className="absolute top-8 right-8 port-indicator"></div>
                <div className="mb-8 w-14 h-14 bg-secondary-fixed flex items-center justify-center rounded-2xl">
                  <span className="material-symbols-outlined text-secondary text-3xl" style={{ fontVariationSettings: '"FILL" 1' }}>download</span>
                </div>
                <span className="font-code-sm text-secondary mb-3 block tracking-widest">03 SHIP IT</span>
                <h3 className="font-title-md text-headline-lg-mobile mb-4 text-on-surface">Native Export</h3>
                <p className="font-body-sm text-body-lg text-on-surface-variant">
                  Download validated native DevExpress .REPX files or detailed specs ready for immediate production deployment.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CTAs / Final Punch */}
        <section className="py-24 bg-[#040d1b] text-white text-center">
          <div className="max-w-container-max mx-auto px-margin-desktop">
            <h2 className="font-headline-lg text-headline-lg font-bold mb-6">Let's build something precise.</h2>
            <p className="font-body-lg text-on-primary-container max-w-2xl mx-auto mb-10 opacity-80">
              Join teams using Forma to transform designs into production-ready reports and ship faster.
            </p>
            <button
              onClick={onEnterWorkspace}
              className="bg-secondary-container text-white px-12 py-4 font-label-caps transition-all hover:bg-secondary active:scale-95 rounded-full shadow-2xl shadow-black/20 text-body-lg cursor-pointer"
            >
              Launch Workspace
            </button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full bg-surface-container-lowest dark:bg-card border-t border-outline-variant py-10 mt-auto">
        <div className="max-w-container-max mx-auto px-margin-desktop flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 text-[11px] text-on-surface-variant font-sans">

          {/* Left side: Logo, brand, tagline */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 select-none shrink-0">
              <Logo size={20} />
              <span className="font-bold text-sm text-secondary-container">Forma</span>
            </div>
            <div className="h-6 w-px bg-outline-variant/40 hidden sm:block"></div>
            <p className="font-body-sm text-[12px] leading-relaxed text-on-surface-variant max-w-[340px]">
              Â© 2026 Forma. All rights reserved.<br />Designed & Built by <strong className="text-secondary-container font-bold">Waqar Sayyed</strong>
            </p>
          </div>
          {/* Middle side: Navigation links */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 select-none text-[12px]">
            <a href="#" className="hover:text-primary transition-all duration-200 hover:scale-105">Product</a>
            <span className="text-outline-variant text-[21px] font-bold">â€¢</span>
            <a href="#features" className="hover:text-primary transition-all duration-200 hover:scale-105">Features</a>
            <span className="text-outline-variant text-[21px] font-bold">â€¢</span>
            <a href="#docs" className="hover:text-primary transition-all duration-200 hover:scale-105">Docs</a>
            <span className="text-outline-variant text-[21px] font-bold">â€¢</span>
            <a href="#contact" className="hover:text-primary transition-all duration-200 hover:scale-105">Contact</a>
            <span className="text-outline-variant text-[21px] font-bold">â€¢</span>
            <a href="#" className="hover:text-primary transition-all duration-200 text-on-surface-variant/70 hover:scale-105">Privacy</a>
            <span className="text-outline-variant text-[21px] font-bold">â€¢</span>
            <a href="#" className="hover:text-primary transition-all duration-200 text-on-surface-variant/70 hover:scale-105">Terms</a>
          </div>

          {/* Right side: Copyright */}
          <div className="flex items-center gap-6 flex-wrap lg:justify-end">
            {/* Verified Stack removed as per request */}
          </div>
        </div>
      </footer>
      {/* Sub Footer */}
      <div className="w-full bg-surface dark:bg-card py-4 border-t border-outline-variant/30 text-center select-none shrink-0">
        <span className="text-[10px] uppercase font-mono text-on-surface-variant">
          Crafting the future of report generation.
        </span>
      </div>
    </div>
  );
};


export default LandingPage;
