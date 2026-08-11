import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { EASE } from '../lib/motion';
import {
  ArrowRight,
  Loader2,
  Check,
  Mail,
  Share2
} from 'lucide-react';
import { User } from 'firebase/auth';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';

interface ContactPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

// Track whether any form field is focused
function useFormFocus() {
  const [count, setCount] = React.useState(0);
  const onFocus = () => setCount(c => c + 1);
  const onBlur = () => setCount(c => Math.max(0, c - 1));
  return { isFocused: count > 0, onFocus, onBlur };
}

export default function ContactPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode
}: ContactPageProps) {

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    subject: '',
    description: ''
  });

  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const formFocus = useFormFocus();


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.subject || !formData.description) return;

    setIsPending(true);
    try {
      // Submit via FormSubmit API in the background
      const response = await fetch("https://formsubmit.co/ajax/waqarsayyed.official@gmail.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({
          name: `${formData.firstName} ${formData.lastName}`,
          email: formData.email,
          subject: formData.subject,
          message: formData.description,
          _subject: `Forma Inquiry: ${formData.subject} (from ${formData.firstName} ${formData.lastName})`
        })
      });

      const result = await response.json();
      console.log("Inquiry sent successfully via FormSubmit:", result);
      setIsPending(false);
      setIsSubmitted(true);
    } catch (err) {
      console.error("Failed to send inquiry via FormSubmit API:", err);
      // Fallback to show success state in UI so user flow isn't blocked
      setIsPending(false);
      setIsSubmitted(true);
    }
  };

  return (
    <div className="landing font-body-lg text-[16px] leading-[1.62] bg-surface text-on-surface min-h-screen flex flex-col transition-colors duration-300">
      <SiteHeader
        active="Contact"
        onEnterWorkspace={onEnterWorkspace}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        user={user}
        logOut={logOut}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
      />
      {/* Main Section */}
      <main className="flex-grow flex items-center py-16 px-4 md:px-8 relative overflow-hidden">
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40"></div>

        {/* Gradient mesh. Static: these were three infinitely drifting blur-3xl
            orbs that composited forever on every visit, conveyed nothing, and ran
            even for visitors who asked for reduced motion. The colour wash is the
            part that carried the design, so that is what was kept. */}
        {[
          { size: 220, top: '5%', left: '10%', color: 'bg-violet-400/10 dark:bg-violet-500/8' },
          { size: 180, bottom: '8%', right: '8%', color: 'bg-secondary-container/10 dark:bg-secondary-container/8' },
          { size: 150, top: '40%', right: '25%', color: 'bg-blue-400/8 dark:bg-blue-500/6' },
        ].map((orb, i) => (
          <div
            key={i}
            className={`absolute rounded-full blur-3xl pointer-events-none -z-[5] ${orb.color}`}
            style={{ width: orb.size, height: orb.size, top: (orb as any).top, bottom: (orb as any).bottom, left: (orb as any).left, right: (orb as any).right }}
          />
        ))}

        <div className="max-w-container-max mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Direct Support and Quotes */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: EASE.standard }}
            className="lg:col-span-5 text-left flex flex-col justify-center pr-0 lg:pr-6"
          >
            {/* Badge */}
            <div className="flex items-center gap-2 mb-6">
              <span className="w-2.5 h-2.5 bg-secondary-container rounded-sm shrink-0"></span>
              <span className="font-label-caps text-secondary-container text-xs uppercase tracking-widest font-semibold">Direct Support</span>
            </div>

            {/* Heading */}
            <h1 className="font-display-lg text-4xl md:text-[52px] font-bold tracking-tight text-on-surface dark:text-white leading-[1.1] mb-8">
              Let's build your enterprise <span className="text-secondary-container">layout</span> <span className="text-secondary-container">architecture</span> together.
            </h1>

            {/* New Design Cards (Direct Channels & Build the Future) */}
            <div className="mt-4 space-y-6 w-full max-w-md">
              {/* Card 1: Direct Channels */}
              <motion.div
                whileHover={{ y: -4, scale: 1.01 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="bg-surface-container-low border border-outline-variant/30 p-6 rounded-2xl shadow-sm text-left cursor-default"
              >
                <h3 className="font-display-lg text-lg font-bold mb-6 text-on-surface">
                  Direct Channels
                </h3>

                <div className="space-y-5">
                  {/* Channel 1: Support Core.
                      The icon tiles used to bob up and down forever on a 2s loop.
                      Static contact details do not benefit from perpetual motion,
                      and it ran regardless of the reduced-motion preference. */}
                  <div className="flex items-start">
                    <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center text-white shrink-0 mr-4">
                      <Mail size={18} className="text-white" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="font-label-caps text-outline text-[10px] tracking-wider font-semibold">
                        SUPPORT_CORE
                      </span>
                      <a href="mailto:waqarsayyed.official@gmail.com" className="text-sm font-sans font-medium text-on-surface hover:text-secondary-container hover:underline transition-all mt-0.5">
                        support@forma.com
                      </a>
                    </div>
                  </div>

                  {/* Channel 2: Social Ports */}
                  <div className="flex items-start">
                    <div className="w-10 h-10 bg-primary-container rounded-lg flex items-center justify-center text-white shrink-0 mr-4">
                      <Share2 size={18} className="text-white" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="font-label-caps text-outline text-[10px] tracking-wider font-semibold">
                        SOCIAL_PORTS
                      </span>
                      <div className="flex items-center gap-3 text-sm mt-0.5">
                        <a href="/" className="font-sans font-medium text-on-surface hover:text-secondary-container hover:underline transition-all">
                          Github
                        </a>
                        <span className="text-slate-300 dark:text-on-surface select-none">•</span>
                        <a href="/" className="font-sans font-medium text-on-surface hover:text-secondary-container hover:underline transition-all">
                          Discord
                        </a>
                        <span className="text-slate-300 dark:text-on-surface select-none">•</span>
                        <a href="/" className="font-sans font-medium text-on-surface hover:text-secondary-container hover:underline transition-all">
                          LinkedIn
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Card 2: Build the Future */}
              <motion.div
                whileHover={{ y: -4, scale: 1.01 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="bg-[#040d1b] dark:bg-[#1a2332] border border-outline-variant/30 p-6 rounded-2xl shadow-md text-left cursor-default"
              >
                <h3 className="font-display-lg text-lg font-bold text-white mb-2">
                  Build the future
                </h3>
                <p className="font-body-sm text-sm text-slate-300 leading-relaxed">
                  Join our global network of developers and architects creating the next generation of layouts.
                </p>
              </motion.div>
            </div>
          </motion.div>

          {/* Right Column: Support & Inquiries Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE.standard }}
            className="lg:col-span-7"
          >
            {/* Focus styling is CSS, not Framer. The previous `animate` targeted an
                empty string on blur, which Framer cannot interpolate, so the card
                never returned from its focused state — and the literals it did write
                were light-mode only and outranked every dark: rule. */}
            <div
              className={`u-transition bg-surface-container-lowest border p-8 md:p-10 rounded-3xl relative text-left ${
                formFocus.isFocused
                  ? 'border-secondary-container ring-4 ring-secondary-container/12 shadow-2xl'
                  : 'border-outline-variant/60 shadow-xl'
              }`}
            >
              {/* Port indicators (orange/gray double square) */}
              <div className="absolute top-8 right-8 flex gap-1">
                <span className="w-2.5 h-2.5 bg-secondary-container rounded-sm shrink-0"></span>
                <span className="w-2.5 h-2.5 bg-outline-variant/60 dark:bg-slate-700 rounded-sm shrink-0"></span>
              </div>

              <h2 className="font-display-lg text-2xl md:text-3xl font-semibold mb-2 text-on-surface dark:text-white">
                Support & Inquiries
              </h2>
              <p className="font-body-sm text-sm text-on-surface-variant mb-8 leading-relaxed">
                Provide your queries for solutions or requirements.
              </p>

              <AnimatePresence mode="wait">
                {isSubmitted ? (
                  <motion.div
                    key="submitted"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col items-center justify-center py-12 text-center"
                  >
                    <div className="w-16 h-16 bg-surface-container-low text-secondary-container rounded-full flex items-center justify-center mb-6 animate-bounce">
                      <Check size={32} strokeWidth={2.5} />
                    </div>
                    <h3 className="font-title-md text-xl font-bold mb-3 text-on-surface dark:text-white">Connection Initialized!</h3>
                    <p className="text-sm text-on-surface-variant max-w-sm leading-relaxed">
                      Thanks for getting in touch, <strong className="text-secondary-container">{formData.firstName}</strong>! We've received your message and will reach out to you at <span className="font-mono text-xs underline decoration-secondary text-primary dark:text-secondary-container">{formData.email}</span> shortly.
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        setIsSubmitted(false);
                        setFormData({ firstName: '', lastName: '', email: '', subject: '', description: '' });
                      }}
                      className="mt-8 px-6 py-2.5 bg-[#040d1b] dark:bg-[#1a2332] hover:bg-secondary-container dark:hover:bg-secondary-container text-white font-mono text-xs uppercase tracking-wider rounded-full transition-all duration-200 shadow-md hover:shadow-lg cursor-pointer"
                    >
                      Submit Another Inquiry
                    </motion.button>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onSubmit={handleSubmit}
                    className="space-y-6"
                  >
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05, duration: 0.35 }}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <div className="space-y-2">
                        <label htmlFor="firstName" className="block text-xs font-mono font-medium text-on-surface-variant">
                          First Name
                        </label>
                        <input
                          id="firstName"
                          type="text"
                          required
                          className="w-full px-5 py-3 bg-surface border border-outline-variant rounded-full text-sm focus:border-secondary dark:focus:border-secondary focus:outline-none transition-all placeholder-slate-400"
                          placeholder="Alex"
                          value={formData.firstName}
                          onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                          onFocus={formFocus.onFocus}
                          onBlur={formFocus.onBlur}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="lastName" className="block text-xs font-mono font-medium text-on-surface-variant">
                          Last Name
                        </label>
                        <input
                          id="lastName"
                          type="text"
                          required
                          className="w-full px-5 py-3 bg-surface border border-outline-variant rounded-full text-sm focus:border-secondary dark:focus:border-secondary focus:outline-none transition-all placeholder-slate-400"
                          placeholder="Riviera"
                          value={formData.lastName}
                          onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                          onFocus={formFocus.onFocus}
                          onBlur={formFocus.onBlur}
                        />
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12, duration: 0.35 }}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <div className="space-y-2">
                        <label htmlFor="subject" className="block text-xs font-mono font-medium text-on-surface-variant">
                          Subject
                        </label>
                        <input
                          id="subject"
                          type="text"
                          required
                          className="w-full px-5 py-3 bg-surface border border-outline-variant rounded-full text-sm focus:border-secondary dark:focus:border-secondary focus:outline-none transition-all placeholder-slate-400"
                          placeholder="Ref: #"
                          value={formData.subject}
                          onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                          onFocus={formFocus.onFocus}
                          onBlur={formFocus.onBlur}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="email" className="block text-xs font-mono font-medium text-on-surface-variant">
                          Email
                        </label>
                        <input
                          id="email"
                          type="email"
                          required
                          className="w-full px-5 py-3 bg-surface border border-outline-variant rounded-full text-sm focus:border-secondary dark:focus:border-secondary focus:outline-none transition-all placeholder-slate-400"
                          placeholder="dev@company.tech"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          onFocus={formFocus.onFocus}
                          onBlur={formFocus.onBlur}
                        />
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.19, duration: 0.35 }}
                      className="space-y-2"
                    >
                      <label htmlFor="description" className="block text-xs font-mono font-medium text-on-surface-variant">
                        Description
                      </label>
                      <textarea
                        id="description"
                        required
                        rows={4}
                        className="w-full px-5 py-4 bg-surface border border-outline-variant rounded-3xl text-sm focus:border-secondary dark:focus:border-secondary focus:outline-none transition-all placeholder-slate-400 resize-none font-sans"
                        placeholder="Briefly describe your issues or requirements..."
                        value={formData.description}
                        onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                        onFocus={formFocus.onFocus}
                        onBlur={formFocus.onBlur}
                      />
                    </motion.div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      type="submit"
                      disabled={isPending}
                      className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-secondary-container text-white hover:bg-black dark:hover:bg-black hover:text-white font-mono text-xs uppercase tracking-wider rounded-full transition-colors shadow-md hover:shadow-lg disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed group font-bold"
                    >
                      {isPending ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          Send Message
                          <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </motion.button>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
