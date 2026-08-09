import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, Variants, useMotionValue, useSpring, useInView, useReducedMotion } from 'motion/react';
import { EASE } from '../lib/motion';
import {
  Cpu,
  Layers,
  Download,
  Terminal,
  Play,
  RefreshCw,
  ArrowRight,
  CheckCircle,
  FileCode,
  Image as ImageIcon,
  ScanLine,
  Box,
  Code2
} from 'lucide-react';
import { User } from 'firebase/auth';
import UserAvatar from './UserAvatar';
import MobileNav from './MobileNav';
import Logo from './Logo';
import { navigate } from '../lib/router';

interface FeaturesPageProps {
  onEnterWorkspace: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
  user: User | null;
  logOut: () => void;
  isDarkMode: boolean;
  setIsDarkMode: (val: boolean) => void;
}

interface MockElement {
  id: string;
  type: 'label' | 'image' | 'table' | 'barcode' | 'line';
  content: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  bgColor?: string;
}

interface MockTemplate {
  name: string;
  description: string;
  elements: MockElement[];
}

// Performant Framer Motion Animation Variants (GPU-accelerated, reduced-motion friendly)
const heroContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0,
    },
  },
};

const fadeInUpVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE.standard },
  },
};

const bentoGridVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      // 6 bento cards: keep the last card's start under ~0.2s, otherwise the
      // grid still looks like it is loading well after it is on screen.
      staggerChildren: 0.04,
      delayChildren: 0,
    },
  },
};

const bentoCardVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE.standard },
  },
};

// Animated counter component
function AnimatedCounter({ value, suffix = '' }: { value: number | string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-30px' });
  const [displayed, setDisplayed] = useState(0);
  const isNumber = typeof value === 'number';

  useEffect(() => {
    if (!inView || !isNumber) return;
    const end = value as number;
    const duration = 1200;
    let frame = 0;
    let last = -1;

    const step = (timestamp: number, startTime: number) => {
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.floor(eased * end);
      // Only re-render when the displayed integer actually changes — these
      // counters are small numbers, so most frames are a no-op.
      if (next !== last) {
        last = next;
        setDisplayed(next);
      }
      if (progress < 1) frame = requestAnimationFrame((ts) => step(ts, startTime));
    };

    frame = requestAnimationFrame((ts) => step(ts, ts));
    return () => cancelAnimationFrame(frame);
  }, [inView, value, isNumber]);

  return (
    <span ref={ref}>
      {isNumber ? displayed : value}{suffix}
    </span>
  );
}

// Ultra-performant 3D Tilt card wrapper (Zero layout thrashing, fast spring physics)
function TiltCard({ children, className }: { children: React.ReactNode; className?: string }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const frameRef = useRef(0);
  const prefersReduced = useReducedMotion();

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);

  // Fast, responsive spring (stiffness: 400, damping: 28 for instant responsiveness without lag)
  const springX = useSpring(rotateX, { stiffness: 400, damping: 28 });
  const springY = useSpring(rotateY, { stiffness: 400, damping: 28 });

  const handleMouseEnter = useCallback(() => {
    if (!cardRef.current) return;
    rectRef.current = cardRef.current.getBoundingClientRect();
    // Promote to its own layer only while the pointer is actually here.
    // Leaving will-change on permanently pinned a GPU layer per card.
    cardRef.current.style.willChange = 'transform';
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (prefersReduced) return;
    if (!rectRef.current && cardRef.current) {
      rectRef.current = cardRef.current.getBoundingClientRect();
    }
    const rect = rectRef.current;
    if (!rect) return;

    // Coalesce to one update per frame; high-polling-rate mice fire mousemove
    // far more often than the compositor can use.
    const clientX = e.clientX;
    const clientY = e.clientY;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Smooth, high-performance 3D tilt (max 4.5 degrees)
      rotateX.set(((y - centerY) / centerY) * -4.5);
      rotateY.set(((x - centerX) / centerX) * 4.5);
    });
  }, [rotateX, rotateY, prefersReduced]);

  const handleMouseLeave = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    rectRef.current = null;
    rotateX.set(0);
    rotateY.set(0);
    if (cardRef.current) cardRef.current.style.willChange = '';
  }, [rotateX, rotateY]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <motion.div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={prefersReduced ? undefined : { y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      style={{
        rotateX: springX,
        rotateY: springY,
        transformPerspective: 1000,
        // No preserve-3d: nothing here is positioned in 3D space, and it forced
        // a 3D rendering context around every blurred child in the card.
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

const TEMPLATES: Record<string, MockTemplate> = {
  invoice: {
    name: "Commercial Invoice Mockup",
    description: "Standard sales invoice layout featuring a corporate header, itemized pricing grid, and footer summaries.",
    elements: [
      { id: "h-bg", type: "label", content: "Header Background", x: 0, y: 0, w: 420, h: 45, bgColor: "#0f172a", color: "#ffffff" },
      { id: "h-logo", type: "image", content: "Corporate Logo", x: 15, y: 10, w: 50, h: 25 },
      { id: "h-title", type: "label", content: "INVOICE DEPT", x: 260, y: 12, w: 140, h: 20, color: "#fe6b00" },
      { id: "t-header", type: "table", content: "Table Column Headers", x: 15, y: 65, w: 390, h: 22, bgColor: "#f1f5f9" },
      { id: "t-row1", type: "label", content: "Item A - $450.00", x: 15, y: 92, w: 390, h: 20 },
      { id: "t-row2", type: "label", content: "Item B - $220.00", x: 15, y: 115, w: 390, h: 20 },
      { id: "f-line", type: "line", content: "Divider Line", x: 15, y: 145, w: 390, h: 2 },
      { id: "f-total", type: "label", content: "Total Due: $670.00", x: 240, y: 155, w: 165, h: 22, color: "#0f172a" },
      { id: "f-num", type: "label", content: "Page 1 of 1", x: 15, y: 185, w: 80, h: 15 }
    ]
  },
  receipt: {
    name: "Retail Sales Receipt",
    description: "A narrow layout showing retail store details, quick transaction summaries, and system barcodes.",
    elements: [
      { id: "r-name", type: "label", content: "FORMA CONVENIENCE STORE", x: 80, y: 10, w: 260, h: 22 },
      { id: "r-date", type: "label", content: "Date: 2026-06-21 14:22", x: 40, y: 38, w: 340, h: 18 },
      { id: "r-div1", type: "line", content: "Line Break", x: 40, y: 60, w: 340, h: 2 },
      { id: "r-item1", type: "label", content: "1x Premium Latte - $4.50", x: 40, y: 70, w: 340, h: 18 },
      { id: "r-item2", type: "label", content: "2x Butter Croissants - $6.00", x: 40, y: 92, w: 340, h: 18 },
      { id: "r-total", type: "label", content: "TOTAL: $10.50", x: 40, y: 120, w: 340, h: 22 },
      { id: "r-div2", type: "line", content: "Line Break", x: 40, y: 150, w: 340, h: 2 },
      { id: "r-barcode", type: "barcode", content: "TX-99812-OK", x: 110, y: 162, w: 200, h: 36 }
    ]
  },
  badge: {
    name: "Employee Identity Badge",
    description: "A compact label layout featuring photo slots, database fields, and scanning identification codes.",
    elements: [
      { id: "b-header", type: "label", content: "FORMA TECHNOLOGIES", x: 15, y: 10, w: 390, h: 24, bgColor: "#fe6b00", color: "#ffffff" },
      { id: "b-photo", type: "image", content: "Employee Photo Slot", x: 150, y: 48, w: 120, h: 80 },
      { id: "b-name", type: "label", content: "Waqar Sayyed", x: 15, y: 138, w: 390, h: 22, color: "#0f172a" },
      { id: "b-role", type: "label", content: "Software Engineer", x: 15, y: 162, w: 390, h: 18 },
      { id: "b-barcode", type: "barcode", content: "EMP-44280", x: 90, y: 190, w: 240, h: 32 }
    ]
  }
};

// XML, JSON, Markdown generators for Option A & B
const generateRepxXml = (templateKey: string, elements: MockElement[]) => {
  const controlsXml = elements.map((el, index) => {
    const controlType = el.type === 'label' ? 'XRLabel'
      : el.type === 'image' ? 'XRPictureBox'
        : el.type === 'table' ? 'XRTable'
          : el.type === 'barcode' ? 'XRBarCode'
            : 'XRLine';
    const bgAttr = el.bgColor ? ` BackColor="${el.bgColor}"` : '';
    const fgAttr = el.color ? ` ForeColor="${el.color}"` : '';
    const textAttr = el.content ? ` Text="${el.content}"` : '';

    return `        <Item${index + 1} Ref="${index + 3}" ControlType="${controlType}" Name="${el.id}" SizeF="${el.w},${el.h}" LocationFloat="${el.x},${el.y}"${bgAttr}${fgAttr}${textAttr} />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<XtraReportsLayoutSerializer SerializerVersion="26.1.1.0" Ref="0" ControlType="DevExpress.XtraReports.UI.XtraReport" Name="${templateKey}_Report" Margins="40, 40, 40, 40" PageWidth="850" PageHeight="1100">
  <Bands>
    <Item1 Ref="1" ControlType="TopMarginBand" Name="TopMargin" HeightF="40" />
    <Item2 Ref="2" ControlType="DetailBand" Name="Detail" HeightF="260">
      <Controls>
${controlsXml}
      </Controls>
    </Item2>
    <Item3 Ref="99" ControlType="BottomMarginBand" Name="BottomMargin" HeightF="40" />
  </Bands>
</XtraReportsLayoutSerializer>`;
};

const generateJsonMap = (templateKey: string, elements: MockElement[]) => {
  const template = TEMPLATES[templateKey];
  return JSON.stringify({
    templateName: template?.name || templateKey,
    description: template?.description || '',
    canvasSize: { width: 420, height: 240 },
    engineVersion: "v2.4-Aida",
    elementsCount: elements.length,
    elements: elements.map(el => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.w,
      height: el.h,
      text: el.content,
      bgColor: el.bgColor || null,
      color: el.color || null
    }))
  }, null, 2);
};

const generateMarkdownSpec = (templateKey: string, elements: MockElement[]) => {
  const template = TEMPLATES[templateKey];
  const elementRows = elements.map(el =>
    `| \`${el.id}\` | **${el.type.toUpperCase()}** | X: ${el.x}, Y: ${el.y} | ${el.w}x${el.h}px | \`${el.bgColor || 'Transparent'}\` | "${el.content}" |`
  ).join('\n');

  return `# Layout Specification: ${template?.name || templateKey}

## Document Properties
- **Template ID**: \`${templateKey}\`
- **Output Target**: DevExpress .REPX (XML)
- **Calculated Bounds**: 420px x 240px
- **Coordinate Grid**: Absolute Cartesian (0,0 is Top-Left)

## Structured Component Banding Map

| Element ID | Type | Placement | Dimensions | Background | Content / Bindings |
| :--- | :--- | :--- | :--- | :--- | :--- |
${elementRows}

*Generated automatically by Forma AI Parser Engine (v2.4-Aida).*`;
};

const renderXmlCode = (xml: string) => {
  return xml.split('\n').map((line, idx) => {
    if (line.trim().startsWith('<') || line.trim().startsWith('</')) {
      return (
        <div key={idx} className="whitespace-pre leading-5 text-[10px]">
          <span className="text-on-surface-variant">{line.match(/^\s*/)?.[0]}</span>
          <span className="text-blue-400">&lt;</span>
          <span className="text-teal-400">{line.trim().split(' ')[0].replace(/[<>/]/g, '')}</span>
          {line.trim().includes(' ') && (
            <span className="text-slate-300">
              {line.trim().slice(line.trim().indexOf(' ')).replace(/"[^"]*"/g, (match) => {
                return `"${match.replace(/"/g, '')}"`;
              }).split(/(\w+=)/g).map((part, pIdx) => {
                if (part.endsWith('=')) {
                  return <span key={pIdx} className="text-violet-400">{part}</span>;
                } else if (part.startsWith('"') && part.endsWith('"')) {
                  return <span key={pIdx} className="text-amber-300">{part}</span>;
                }
                return part;
              })}
            </span>
          )}
          <span className="text-blue-400">{line.trim().endsWith('/>') ? ' />' : line.trim().endsWith('>') ? '>' : ''}</span>
        </div>
      );
    }
    return <div key={idx} className="whitespace-pre leading-5 text-slate-300 text-[10px]">{line}</div>;
  });
};

const renderJsonCode = (json: string) => {
  return json.split('\n').map((line, idx) => {
    const parts = line.split(/("[^"]*":?)/g);
    return (
      <div key={idx} className="whitespace-pre leading-5 text-[10px]">
        {parts.map((part, pIdx) => {
          if (part.endsWith(':')) {
            return <span key={pIdx} className="text-teal-400 font-semibold">{part}</span>;
          } else if (part.startsWith('"') && part.endsWith('"')) {
            return <span key={pIdx} className="text-amber-300">{part}</span>;
          } else if (!isNaN(Number(part.trim())) || part.trim() === 'true' || part.trim() === 'false' || part.trim() === 'null') {
            return <span key={pIdx} className="text-violet-400">{part}</span>;
          }
          return <span key={pIdx} className="text-slate-300">{part}</span>;
        })}
      </div>
    );
  });
};

const renderMarkdownCode = (markdown: string) => {
  return markdown.split('\n').map((line, idx) => {
    if (line.startsWith('#')) {
      return <div key={idx} className="whitespace-pre font-bold text-sky-400 leading-7 text-xs font-mono">{line}</div>;
    } else if (line.startsWith('-') || line.startsWith('*')) {
      return (
        <div key={idx} className="whitespace-pre text-slate-300 leading-5 text-[10px]">
          <span className="text-secondary-container mr-1.5">•</span>
          {line.slice(1)}
        </div>
      );
    } else if (line.startsWith('|')) {
      return (
        <div key={idx} className="whitespace-pre text-indigo-300 font-mono leading-5 bg-slate-900/40 px-2 py-0.5 border-x border-slate-900 text-[10px] inline-block min-w-full">
          {line.split('|').map((col, cIdx) => {
            if (cIdx === 0 || cIdx === line.split('|').length - 1) return null;
            return (
              <React.Fragment key={cIdx}>
                <span className="text-on-surface-variant">|</span>
                <span className="px-2 text-slate-300">{col}</span>
              </React.Fragment>
            );
          })}
          <span className="text-on-surface-variant">|</span>
        </div>
      );
    }
    return <div key={idx} className="whitespace-pre text-slate-400 leading-5 text-[10px]">{line}</div>;
  });
};

export default function FeaturesPage({
  onEnterWorkspace,
  onSignIn,
  onSignUp,
  user,
  logOut,
  isDarkMode,
  setIsDarkMode
}: FeaturesPageProps) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const prefersReduced = useReducedMotion();

  // Motion does not pause off-screen animations, so every infinite loop on this
  // page is gated on visibility — otherwise it composites forever while the user
  // is reading a section three screens away.
  //
  // The hero no longer needs a gate: its ambient particles were reduced to static
  // dots, so there is nothing left there to pause. `heroInView`/`heroRef` used to
  // sit here marking a gate that was never wired; the animation they were meant
  // to gate is gone, so they went with it.
  const ctaRef = useRef<HTMLElement>(null);
  const ctaInView = useInView(ctaRef, { margin: '80px' });
  // The bento grid's scanning laser is the expensive one — a full-width gradient
  // with a box-shadow, transform-animated on a 4s loop that never ends.
  const bentoRef = useRef<HTMLElement>(null);
  const bentoInView = useInView(bentoRef, { margin: '80px' });

  // Interactive Demo State
  const [selectedTemplate, setSelectedTemplate] = useState<keyof typeof TEMPLATES>('invoice');
  const [parseStatus, setParseStatus] = useState<'idle' | 'analyzing' | 'done'>('idle');
  const [parseProgress, setParseProgress] = useState(0);
  const [parseLogs, setParseLogs] = useState<string[]>([]);
  const [selectedElement, setSelectedElement] = useState<MockElement | null>(null);
  const [activeTab, setActiveTab] = useState<'visualizer' | 'repx' | 'json' | 'markdown'>('visualizer');
  const [copied, setCopied] = useState(false);

  // Option B AI Refinement States
  const [promptInput, setPromptInput] = useState('');
  const [promptApplying, setPromptApplying] = useState(false);
  const [promptLog, setPromptLog] = useState('');
  const [customElements, setCustomElements] = useState<MockElement[] | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyPrompt = () => {
    if (!promptInput.trim()) return;
    setPromptApplying(true);
    setPromptLog('Analyzing AI prompt command...');

    setTimeout(() => {
      const template = TEMPLATES[selectedTemplate];
      const baseElements = customElements || template.elements;
      // Deep copy to prevent mutating static elements
      const updated = baseElements.map(el => ({ ...el }));
      const text = promptInput.toLowerCase();
      let changeLog = '';

      if (text.includes('slate') || text.includes('dark') || text.includes('black')) {
        const header = updated.find(el => el.id.includes('header') || el.id.includes('bg'));
        if (header) {
          header.bgColor = '#1e293b'; // slate-800
          header.color = '#ffffff';
          changeLog = '✓ Changed header theme to dark slate.';
        } else {
          changeLog = '✓ Applied dark theme overrides.';
        }
      } else if (text.includes('red') || text.includes('crimson') || text.includes('rose')) {
        const header = updated.find(el => el.id.includes('header') || el.id.includes('bg'));
        if (header) {
          header.bgColor = '#ef4444'; // red-500
          header.color = '#ffffff';
          changeLog = '✓ Applied red primary accent color.';
        } else {
          changeLog = '✓ Applied crimson layout accents.';
        }
      } else if (text.includes('orange') || text.includes('brand') || text.includes('primary')) {
        const header = updated.find(el => el.id.includes('header') || el.id.includes('bg'));
        if (header) {
          header.bgColor = '#fe6b00'; // orange
          header.color = '#ffffff';
          changeLog = '✓ Reverted to primary orange branding theme.';
        } else {
          changeLog = '✓ Reverted layouts to primary accent theme.';
        }
      } else if (text.includes('barcode') || text.includes('scan')) {
        const hasBarcode = updated.some(el => el.type === 'barcode');
        if (!hasBarcode) {
          updated.push({
            id: 'ai-barcode',
            type: 'barcode',
            content: 'PROMPT-BAR-99',
            x: 110,
            y: 190,
            w: 200,
            h: 30
          });
          changeLog = '✓ Synthesized and inserted barcode element.';
        } else {
          changeLog = '✓ Barcode element already exists in coordinates grid.';
        }
      } else if (text.includes('add') || text.includes('label') || text.includes('text') || text.includes('insert')) {
        updated.push({
          id: 'ai-label-' + (updated.length + 1),
          type: 'label',
          content: 'AI Added Field',
          x: 20,
          y: 205,
          w: 120,
          h: 20,
          color: '#fe6b00'
        });
        changeLog = '✓ Added new text label node at bounds (20, 205).';
      } else {
        updated.forEach(el => {
          if (el.id !== 'h-bg' && el.id !== 'b-header') {
            el.x = Math.max(0, el.x + (Math.random() > 0.5 ? 8 : -8));
          }
        });
        changeLog = '✓ Shifted coordinate alignments for pixel matching.';
      }

      setCustomElements(updated);
      setPromptLog(changeLog);
      setPromptApplying(false);
    }, 1000);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSimulateParse = () => {
    if (parseStatus === 'analyzing') return;

    setParseStatus('analyzing');
    setParseProgress(0);
    setSelectedElement(null);
    setActiveTab('visualizer');
    setCustomElements(null);
    setPromptInput('');
    setPromptLog('');
    setParseLogs(["[System] Ingesting layout image...", "[Engine] Initializing parser context..."]);

    const logSequence = [
      { progress: 20, log: "[OCR] Analyzing text boundaries and font weights..." },
      { progress: 40, log: "[Segmenter] Mapped Detail Band and bounding coordinate boxes..." },
      { progress: 60, log: "[XML] Generating DevExpress .REPX nodes schema structure..." },
      { progress: 85, log: "[Engine] Validating layout constraints and pixel grids..." },
      { progress: 100, log: "[Success] Report Layout generated! Mapped all elements successfully." }
    ];

    logSequence.forEach((step, index) => {
      setTimeout(() => {
        setParseProgress(step.progress);
        setParseLogs(prev => [...prev, step.log]);
        if (step.progress === 100) {
          setParseStatus('done');
        }
      }, (index + 1) * 800);
    });
  };

  const currentTemplate = TEMPLATES[selectedTemplate];
  const currentElements = customElements || currentTemplate.elements;

  return (
    <div className="font-body-lg text-body-lg bg-surface text-on-surface min-h-screen flex flex-col">
      {/* TopNavBar */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full sticky top-0 z-50 bg-surface-container-lowest/80 backdrop-blur-md border-b border-outline-variant"
      >
        <nav className="flex justify-between items-center px-margin-desktop py-4 max-w-container-max mx-auto">
          <div className="flex items-center gap-4">
            <div
              onClick={() => { navigate('/'); }}
              className="flex items-center gap-4 cursor-pointer hover:opacity-85 transition-opacity"
            >
              <Logo size={32} />
              <div className="flex flex-col">
                <span className="font-display-lg text-title-md font-bold text-primary">Forma</span>
                <span className="font-label-caps text-[10px] tracking-widest text-on-surface-variant uppercase hidden lg:block">Show it. Build it. Ship it.</span>
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="/">Product</a>
            <a className="text-secondary font-bold border-b-2 border-secondary pb-1 font-title-md text-body-sm transition-colors duration-200" href="/features">Features</a>
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="/docs">Docs</a>
            <a className="text-on-surface-variant font-title-md text-body-sm hover:text-secondary transition-colors duration-200" href="/contact">Contact</a>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <MobileNav active="Features" signedIn={!!user} />
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
      </motion.header>

      <main className="flex-grow">
        {/* Hero Section with Framer Motion Staggered Entrance */}
        <motion.section
          variants={heroContainerVariants}
          initial="hidden"
          animate="visible"
          className="pt-20 pb-16 bg-gradient-to-b from-surface to-surface-container border-b border-outline-variant/40 relative overflow-hidden"
        >
          {/* Ambient particles. Static: six dots bobbing and pulsing on endless
              3-5s loops is ambient noise, not information. */}
          {[
            { w: 6, h: 6, left: '8%', top: '20%' },
            { w: 4, h: 4, left: '18%', top: '65%' },
            { w: 8, h: 8, left: '75%', top: '15%' },
            { w: 5, h: 5, left: '85%', top: '70%' },
            { w: 3, h: 3, left: '50%', top: '80%' },
            { w: 7, h: 7, left: '60%', top: '30%' },
          ].map((p, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-secondary-container/25 opacity-30 pointer-events-none"
              style={{ width: p.w, height: p.h, left: p.left, top: p.top }}
            />
          ))}

          <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
            <motion.span
              variants={fadeInUpVariants}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-secondary-container/10 border border-secondary-container/20 rounded-full text-xs font-bold text-secondary-container tracking-wide uppercase font-mono mb-4 shadow-sm"
            >
              {/* The icon used to rock back and forth on an endless 4s loop. It is
                  a static badge label; the motion added no information. */}
              <Cpu size={12} />
              Forma Platform Specs
            </motion.span>

            <motion.h1
              variants={fadeInUpVariants}
              className="text-4xl md:text-5xl font-bold tracking-tight text-on-surface mb-6 leading-tight"
            >
              Report Engineering,{' '}
              {/* The gradient word previously carried a white sweep that repeated
                  forever. It read as a flash over the headline rather than a
                  highlight — and in dark mode a white/60 sweep was harsh. The
                  gradient alone already does the emphasis. */}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-secondary-container via-orange-500 to-amber-500">Redefined</span>
            </motion.h1>

            <motion.p
              variants={fadeInUpVariants}
              className="text-base md:text-lg text-on-surface-variant max-w-3xl mx-auto leading-relaxed"
            >
              Explore the detailed technical architectures and features that empower Forma to parse unstructured layout geometries and synthesize pixel-perfect DevExpress formats.
            </motion.p>
          </div>
        </motion.section>

        {/* Visual Specifications Bento Grid with Scroll-Triggered Reveal */}
        <section ref={bentoRef} className="py-20 bg-surface-container-lowest">
          <div className="max-w-6xl mx-auto px-6">
            {/* BENTO GRID Container */}
            <motion.div
              variants={bentoGridVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.05 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5 auto-rows-auto"
            >

              {/* BENTO 1 — Multimodal Ingestion — WIDE (col-span-7) */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-7">
                <TiltCard className="h-full bg-gradient-to-br from-[#040d1b] to-[#0f1f3d] rounded-3xl p-8 text-white relative overflow-hidden group hover:shadow-2xl hover:shadow-secondary-container/15 transition-shadow duration-500 cursor-default">
                {/* Shimmer sheen on hover */}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-3xl"
                />
                {/* Background glow */}
                <div className="absolute -top-10 -right-10 w-52 h-52 bg-secondary-container/10 rounded-full blur-3xl group-hover:bg-secondary-container/25 transition-colors duration-500 pointer-events-none"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-secondary-container/20 flex items-center justify-center text-secondary-container">
                      <ImageIcon size={18} />
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-bold">01 — Multimodal Ingestion</span>
                  </div>
                  <h3 className="text-2xl font-bold mb-3 leading-tight">Any image format,<br /><span className="text-secondary-container">instantly parsed</span></h3>
                  <p className="text-slate-400 text-sm leading-relaxed mb-8 max-w-sm">PNGs, JPGs, vector PDFs, or mobile sketches. Our pre-processing pipeline standardizes dimensions and extracts contrast grids for precise boundary detection.</p>
                  {/* Visual: Format pills with micro-interaction */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['PNG', 'bg-blue-500/20 text-blue-300 border-blue-500/30'],
                      ['JPG', 'bg-green-500/20 text-green-300 border-green-500/30'],
                      ['PDF (Vector)', 'bg-violet-500/20 text-violet-300 border-violet-500/30'],
                      ['Sketch / Wireframe', 'bg-amber-500/20 text-amber-300 border-amber-500/30'],
                      ['Mobile Mockup', 'bg-rose-500/20 text-rose-300 border-rose-500/30']
                    ].map(([label, cls]) => (
                      <motion.span
                        key={label}
                        whileHover={{ scale: 1.08, y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold border ${cls} transition-colors cursor-pointer select-none`}
                      >
                        {label}
                      </motion.span>
                    ))}
                  </div>
                  {/* Stats bar with animated counters */}
                  <div className="mt-8 pt-6 border-t border-white/10 grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-2xl font-bold text-white"><AnimatedCounter value={5} suffix="+" /></p>
                      <p className="text-[10px] text-on-surface-variant font-mono uppercase tracking-wider mt-0.5">Input Formats</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-secondary-container"><AnimatedCounter value="< 2s" /></p>
                      <p className="text-[10px] text-on-surface-variant font-mono uppercase tracking-wider mt-0.5">Avg. Ingest Time</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-white"><AnimatedCounter value={99} suffix="%" /></p>
                      <p className="text-[10px] text-on-surface-variant font-mono uppercase tracking-wider mt-0.5">Accuracy Rate</p>
                    </div>
                  </div>
                </div>
              </TiltCard>
              </motion.div>

              {/* BENTO 2 — Coordinates Parser — NARROW (col-span-5) */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-5">
                <TiltCard className="h-full bg-surface border border-outline-variant/50 rounded-3xl p-8 relative overflow-hidden group hover:shadow-xl hover:border-secondary-container/40 transition-all duration-500 cursor-default">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-2xl bg-secondary-container/10 flex items-center justify-center text-secondary-container">
                    <ScanLine size={18} />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant font-bold">02 — Coordinate Parser</span>
                </div>
                <h3 className="text-xl font-bold text-on-surface mb-3">Adaptive spatial hierarchy mapping</h3>
                <p className="text-sm text-on-surface-variant leading-relaxed mb-6">Determines layout bounding boxes, groups cells and lines, and computes absolute positions — zero manual coding required.</p>
                {/* Visual: Animated laser scanning coordinate grid diagram */}
                <div className="relative h-28 bg-surface-container-lowest border border-outline-variant/50 rounded-2xl overflow-hidden select-none">
                  {/* Scanning Laser Line */}
                  <motion.div
                    className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-secondary-container to-transparent z-10 opacity-75 pointer-events-none shadow-[0_0_8px_#fe6b00]"
                    // translate, not `top` — animating `top` relayouts the card
                    // on every frame of an infinite loop. 112px === h-28 parent.
                    // Gated on visibility as well as reduced motion: an infinite
                    // loop keeps compositing while the section is off-screen.
                    animate={prefersReduced || !bentoInView ? undefined : { y: [0, 112, 0] }}
                    transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                  />
                  {/* Grid lines */}
                  <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(var(--color-outline-variant) 1px, transparent 1px), linear-gradient(90deg, var(--color-outline-variant) 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                  {/* Sample bounding boxes */}
                  <div className="absolute border-2 border-secondary-container bg-secondary-container/5 rounded text-[8px] font-mono text-secondary-container flex items-center justify-center font-bold" style={{ left: 12, top: 8, width: 120, height: 20 }}>Header Band</div>
                  <div className="absolute border border-blue-400 bg-blue-500/10 rounded text-[7px] font-mono text-blue-600 dark:text-blue-300 flex items-center justify-center" style={{ left: 12, top: 36, width: 72, height: 16 }}>Label[0]</div>
                  <div className="absolute border border-blue-400 bg-blue-500/10 rounded text-[7px] font-mono text-blue-600 dark:text-blue-300 flex items-center justify-center" style={{ left: 92, top: 36, width: 48, height: 16 }}>Table[1]</div>
                  <div className="absolute border border-outline-variant bg-surface-container-low rounded text-[7px] font-mono text-on-surface-variant flex items-center justify-center" style={{ left: 12, top: 60, width: 120, height: 14 }}>Detail Band</div>
                  <div className="absolute border border-green-400 bg-success/10 rounded text-[7px] font-mono text-success flex items-center justify-center" style={{ left: 12, top: 82, width: 120, height: 14 }}>Footer Band</div>
                  {/* Axis labels */}
                  <span className="absolute right-2 top-1 text-[8px] text-outline font-mono">X →</span>
                  <span className="absolute left-1 bottom-1 text-[8px] text-outline font-mono">Y ↓</span>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <CheckCircle size={12} className="text-success" />
                  <span className="text-[10px] text-on-surface-variant font-mono font-semibold">99.8% coordinate match accuracy</span>
                </div>
              </TiltCard>
              </motion.div>

              {/* BENTO 3 — DevExpress XML — col-span-5 */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-5">
                <TiltCard className="h-full bg-[#040d1b] rounded-3xl p-8 text-white relative overflow-hidden group hover:shadow-2xl transition-shadow duration-500 cursor-default">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/4 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-3xl"
                />
                <div className="absolute bottom-0 left-0 w-40 h-40 bg-teal-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-2xl bg-teal-500/20 flex items-center justify-center text-teal-400">
                      <Code2 size={18} />
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant font-bold">03 — Native .REPX Output</span>
                  </div>
                  <h3 className="text-xl font-bold mb-3 leading-tight">DevExpress XML,<br /><span className="text-teal-400">ready to load</span></h3>
                  {/* Inline XML preview with subtle code hover transition */}
                  <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[10px] space-y-0.5 border border-slate-800 leading-5 mb-4 group-hover:border-teal-500/40 transition-colors">
                    <div><span className="text-blue-400">&lt;</span><span className="text-teal-400">XtraReportsLayoutSerializer</span><span className="text-on-surface-variant"> Ref=</span><span className="text-amber-300">"0"</span><span className="text-blue-400">&gt;</span></div>
                    <div className="pl-3"><span className="text-blue-400">&lt;</span><span className="text-teal-400">Bands</span><span className="text-blue-400">&gt;</span></div>
                    <div className="pl-6"><span className="text-blue-400">&lt;</span><span className="text-teal-400">DetailBand</span><span className="text-violet-400"> HeightF=</span><span className="text-amber-300">"260"</span><span className="text-blue-400"> /&gt;</span></div>
                    <div className="pl-3"><span className="text-blue-400">&lt;/</span><span className="text-teal-400">Bands</span><span className="text-blue-400">&gt;</span></div>
                    <div><span className="text-blue-400">&lt;/</span><span className="text-teal-400">XtraReportsLayoutSerializer</span><span className="text-blue-400">&gt;</span></div>
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed">Match your DevExpress version, set margins and paper types — output opens directly in the Report Designer.</p>
                </div>
              </TiltCard>
              </motion.div>

              {/* BENTO 4 — Section Banding — col-span-7 */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-7">
                <TiltCard className="h-full bg-surface-container-lowest border border-outline-variant/50 rounded-3xl p-8 relative overflow-hidden group hover:shadow-xl hover:border-secondary-container/40 transition-all duration-500 cursor-default">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-2xl bg-secondary-container/10 flex items-center justify-center text-secondary-container">
                    <Layers size={18} />
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant font-bold">04 — Modular Section Banding</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div>
                    <h3 className="text-xl font-bold text-on-surface mb-3">Intelligent layout segmentation</h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed">Automatically divides layouts into the five canonical DevExpress bands, keeping all controls cleanly aligned with zero overlap.</p>
                  </div>
                  {/* Visual: Animated Band diagram */}
                  <div className="space-y-1.5 select-none">
                    {[
                      { label: 'Top Margin Band', color: 'bg-surface-container border-outline-variant text-on-surface-variant' },
                      { label: 'Report Header Band', color: 'bg-secondary-container/10 border-secondary-container/40 text-secondary-container' },
                      { label: 'Detail Band', color: 'bg-blue-500/10 border-blue-500/40 text-blue-600 dark:text-blue-300' },
                      { label: 'Report Footer Band', color: 'bg-success/10 border-success/40 text-success' },
                      { label: 'Bottom Margin Band', color: 'bg-surface-container border-outline-variant text-on-surface-variant' },
                    ].map(({ label, color }) => (
                      <motion.div
                        key={label}
                        whileHover={{ x: 4, scale: 1.02 }}
                        transition={{ duration: 0.2 }}
                        className={`border rounded-lg px-4 py-2 text-[10px] font-mono font-bold flex items-center justify-between ${color} transition-colors cursor-pointer`}
                      >
                        <span>{label}</span>
                        <span className="opacity-50">↔ auto</span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </TiltCard>
              </motion.div>

              {/* BENTO 5 — Developer Console — col-span-4 */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-4">
                <TiltCard className="h-full bg-gradient-to-br from-slate-900 to-slate-950 rounded-3xl p-8 text-white relative overflow-hidden group hover:shadow-2xl transition-all duration-500 cursor-default">
                <motion.div
                  className="absolute inset-0 bg-gradient-to-tr from-white/0 via-violet-500/5 to-white/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-3xl"
                />
                <div className="absolute top-0 right-0 w-24 h-24 bg-violet-500/10 rounded-full blur-2xl pointer-events-none"></div>
                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-2xl bg-violet-500/20 flex items-center justify-center text-violet-400">
                      <Terminal size={18} />
                    </div>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-on-surface-variant font-bold">05 — Dev Console</span>
                  </div>
                  <h3 className="text-xl font-bold mb-3">Full-stack<br /><span className="text-violet-400">debug visibility</span></h3>
                  {/* Mock terminal */}
                  <div className="bg-black rounded-2xl p-3 font-mono text-[10px] space-y-1 border border-slate-800 group-hover:border-violet-500/30 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
                      <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full"></div>
                      <div className="w-2.5 h-2.5 bg-green-500 rounded-full"></div>
                      <span className="ml-auto text-on-surface-variant text-[9px]">sandbox.console</span>
                    </div>
                    <div><span className="text-green-400">›</span> <span className="text-slate-300">POST /api/parse</span> <span className="text-yellow-400">200</span> <span className="text-on-surface-variant">142ms</span></div>
                    <div><span className="text-green-400">›</span> <span className="text-slate-300">OCR extracted</span> <span className="text-teal-400">9 nodes</span></div>
                    <div><span className="text-green-400">›</span> <span className="text-slate-300">XML serialized</span> <span className="text-secondary-container">✓ pass</span></div>
                    {/* The blinking cursor is a CSS animation, which also runs
                        off-screen — same gate, applied by dropping the class. */}
                    <div className="flex items-center gap-1"><span className="text-on-surface-variant">$</span> <span className={`text-on-surface-variant ${bentoInView && !prefersReduced ? 'animate-pulse' : ''}`}>_</span></div>
                  </div>
                </div>
              </TiltCard>
              </motion.div>

              {/* BENTO 6 — Exporter — col-span-8 */}
              <motion.div variants={bentoCardVariants} className="lg:col-span-8">
                <TiltCard className="h-full bg-gradient-to-br from-secondary-container to-[#e05a00] rounded-3xl p-8 text-white relative overflow-hidden group hover:shadow-2xl hover:shadow-secondary-container/30 transition-all duration-500 cursor-default">
                  <div className="absolute -bottom-8 -right-8 w-48 h-48 bg-surface-container-lowest/10 rounded-full blur-3xl pointer-events-none"></div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-5">
                      <div className="w-10 h-10 rounded-2xl bg-surface-container-lowest/20 flex items-center justify-center">
                        <Download size={18} />
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-widest text-white/60 font-bold">06 — Live Exporter</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-end">
                      <div>
                        <h3 className="text-2xl font-bold mb-3 leading-tight">Export anything.<br />Instantly.</h3>
                        <p className="text-white/80 text-sm leading-relaxed">Download REPX files, JSON coordinate maps, or markdown spec sheets in one click. Built for engineers and product managers alike.</p>
                      </div>
                      {/* Export format badges with hover effect */}
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { ext: '.REPX', label: 'DevExpress XML Schema', icon: <Code2 size={14} /> },
                          { ext: '.JSON', label: 'Coordinate Layout Map', icon: <Box size={14} /> },
                          { ext: '.MD', label: 'Markdown Spec Sheet', icon: <FileCode size={14} /> },
                        ].map(({ ext, label, icon }) => (
                          <motion.div
                            key={ext}
                            whileHover={{ scale: 1.02, x: 4 }}
                            className="flex items-center gap-3 bg-surface-container-lowest/10 hover:bg-surface-container-lowest/20 border border-white/20 rounded-2xl px-4 py-2.5 backdrop-blur-sm transition-all cursor-pointer"
                          >
                            <div className="text-white/80">{icon}</div>
                            <div>
                              <span className="text-xs font-bold font-mono text-white">{ext}</span>
                              <span className="ml-2 text-[10px] text-white/70">{label}</span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>

            </motion.div>{/* end bento grid */}
          </div>
        </section>

        {/* Interactive Demo — Studio Workspace with Motion Reveal */}
        <motion.section
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.75, ease: EASE.standard }}
          className="py-0 bg-gradient-to-b from-[#0a0f1a] to-[#040d1b] text-white border-t border-slate-900 overflow-hidden"
        >
          {/* Section Header */}
          <div className="max-w-6xl mx-auto px-6 pt-20 pb-12 text-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-secondary-container/15 border border-secondary-container/25 rounded-full text-xs font-bold text-secondary-container tracking-wide uppercase font-mono mb-5">
              <Play size={11} fill="#fe6b00" /> Live Studio
            </span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
              See Forma in action
            </h2>
            <p className="text-slate-400 max-w-2xl mx-auto text-sm leading-relaxed">
              Pick a report template, run the AI parser, then switch between the live canvas and the generated DevExpress XML — all in the browser, zero setup.
            </p>
          </div>

          {/* Studio Workspace */}
          <div className="max-w-7xl mx-auto px-6 pb-20">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-0 rounded-2xl border border-slate-800/80 bg-[#0d1322] shadow-2xl shadow-black/60 overflow-hidden min-h-[580px]">

              {/* ── PANEL 1: Template Gallery (3 cols) ─────────────────── */}
              <div className="xl:col-span-3 border-r border-slate-800/60 flex flex-col">
                {/* Panel header */}
                <div className="px-5 py-4 border-b border-slate-800/60 flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/70"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/70"></div>
                  </div>
                  <span className="ml-2 text-[10px] font-mono text-on-surface-variant uppercase tracking-widest font-bold">Template Gallery</span>
                </div>
                <div className="flex-1 p-4 space-y-2 overflow-y-auto">
                  {(Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>).map((key, i) => {
                    const icons = [<ImageIcon size={14} />, <FileCode size={14} />, <Box size={14} />];
                    const accent = ['from-blue-600/20 to-blue-600/5', 'from-violet-600/20 to-violet-600/5', 'from-amber-600/20 to-amber-600/5'];
                    const borderActive = ['border-blue-500/60', 'border-violet-500/60', 'border-amber-500/60'];
                    const textActive = ['text-blue-400', 'text-violet-400', 'text-amber-400'];
                    return (
                      <motion.button
                        key={key}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          setSelectedTemplate(key);
                          setParseStatus('idle');
                          setParseProgress(0);
                          setParseLogs([]);
                          setSelectedElement(null);
                          setActiveTab('visualizer');
                          setCustomElements(null);
                          setPromptInput('');
                          setPromptLog('');
                        }}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer group ${selectedTemplate === key
                          ? `bg-gradient-to-br ${accent[i]} ${borderActive[i]}`
                          : 'bg-slate-800/30 border-slate-700/50 hover:bg-slate-800/60 hover:border-slate-600'
                          }`}
                      >
                        <div className="flex items-center gap-2.5 mb-1.5">
                          <span className={`${selectedTemplate === key ? textActive[i] : 'text-on-surface-variant'} transition-colors`}>{icons[i]}</span>
                          <span className={`text-xs font-bold font-mono ${selectedTemplate === key ? 'text-white' : 'text-slate-400'}`}>{TEMPLATES[key].name}</span>
                          {selectedTemplate === key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-secondary-container"></span>}
                        </div>
                        <p className="text-[10px] text-on-surface-variant leading-relaxed pl-[22px]">{TEMPLATES[key].description}</p>
                      </motion.button>
                    );
                  })}
                </div>

                {/* Run button + AI Refinement */}
                <div className="p-4 border-t border-slate-800/60 space-y-3">
                  <motion.button
                    whileHover={parseStatus === 'analyzing' ? {} : { scale: 1.02 }}
                    whileTap={parseStatus === 'analyzing' ? {} : { scale: 0.97 }}
                    onClick={handleSimulateParse}
                    disabled={parseStatus === 'analyzing'}
                    className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-wider transition-all duration-200 ${parseStatus === 'analyzing'
                      ? 'bg-slate-800 text-on-surface-variant cursor-not-allowed'
                      : 'bg-secondary-container hover:bg-[#e05a00] text-white cursor-pointer shadow-lg shadow-secondary-container/20'
                      }`}
                  >
                    {parseStatus === 'analyzing' ? (
                      <><RefreshCw size={14} className="animate-spin" /> Parsing… {parseProgress}%</>
                    ) : (
                      <><Play size={14} fill="white" /> Run Parser</>
                    )}
                  </motion.button>

                  {parseStatus === 'done' && (
                    <div className="space-y-2">
                      <label className="text-[9px] font-mono text-on-surface-variant uppercase tracking-widest font-bold block">AI Refine</label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={promptInput}
                          onChange={(e) => setPromptInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleApplyPrompt()}
                          placeholder="e.g. make header dark, add barcode…"
                          disabled={promptApplying}
                          className="flex-grow px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-[10px] text-white placeholder-slate-600 focus:outline-none focus:border-secondary-container disabled:opacity-50 font-sans"
                        />
                        <button
                          onClick={handleApplyPrompt}
                          disabled={promptApplying || !promptInput.trim()}
                          className="px-3 py-2 bg-slate-700 hover:bg-secondary-container text-slate-300 hover:text-white rounded-lg text-[10px] font-bold font-mono transition-all disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed select-none shrink-0"
                        >
                          {promptApplying ? '…' : '→'}
                        </button>
                      </div>
                      {promptLog && (
                        <p className="text-[9px] text-teal-400 font-mono leading-relaxed">{promptLog}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── PANEL 2: Live Report Canvas (5 cols) ───────────────── */}
              <div className="xl:col-span-5 border-r border-slate-800/60 flex flex-col">
                {/* Panel header */}
                <div className="px-5 py-4 border-b border-slate-800/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full transition-all ${parseStatus === 'analyzing' ? 'bg-yellow-400 animate-ping' :
                      parseStatus === 'done' ? 'bg-green-400' : 'bg-slate-600'
                      }`}></span>
                    <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest font-bold">
                      {parseStatus === 'analyzing' ? 'Parsing Layout…' : parseStatus === 'done' ? 'Canvas Ready' : 'Awaiting Input'}
                    </span>
                  </div>
                  {parseStatus === 'done' && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle size={11} className="text-green-400" />
                      <span className="text-[10px] font-mono text-green-400 font-bold">99.8% match</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center p-6">
                  {parseStatus === 'idle' && (
                    <div className="text-center text-on-surface-variant flex flex-col items-center gap-4 select-none">
                      <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-700 flex items-center justify-center">
                        <Cpu size={28} strokeWidth={1} className="text-on-surface" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-on-surface-variant">Select a template</p>
                        <p className="text-xs text-on-surface mt-1">and hit <span className="text-secondary-container font-bold">Run Parser</span> to start</p>
                      </div>
                    </div>
                  )}

                  {parseStatus === 'analyzing' && (
                    <div className="w-full max-w-sm space-y-5">
                      {/* Progress bar */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-[10px] font-mono text-on-surface-variant">
                          <span>Extraction progress</span>
                          <span className="text-secondary-container font-bold">{parseProgress}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                          <div className="bg-gradient-to-r from-secondary-container to-amber-400 h-full rounded-full transition-all duration-500" style={{ width: `${parseProgress}%` }}></div>
                        </div>
                      </div>
                      {/* Stage log */}
                      <div className="bg-black/40 border border-slate-800 rounded-xl p-4 space-y-1.5 font-mono text-[10px]">
                        {parseLogs.map((log, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-secondary-container shrink-0 mt-0.5">›</span>
                            <span className="text-slate-400 leading-snug">{log}</span>
                          </div>
                        ))}
                        {parseStatus === 'analyzing' && (
                          <div className="flex items-center gap-2">
                            <span className="text-on-surface-variant">›</span>
                            <span className="text-on-surface-variant animate-pulse">processing…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {parseStatus === 'done' && (
                    <div className="w-full space-y-3">
                      {/* ── CANVAS ── */}
                      {/* This is a rendered page preview, so it uses the deliberately
                          theme-invariant paper tokens. On surface-container-lowest it
                          went near-black in dark mode while the ink stayed dark. */}
                      <div className="relative bg-paper rounded-xl border border-outline-variant overflow-hidden shadow-xl select-none" style={{ minHeight: 340 }}>

                        {/* ── INVOICE CANVAS ── */}
                        {selectedTemplate === 'invoice' && (
                          <div className="p-0 font-sans text-on-paper" style={{ fontSize: 11 }}>
                            {/* Header */}
                            {/* primary-container stays dark in both themes; --foreground
                                would invert to near-white and hide the white text. */}
                            <div className="flex items-center justify-between px-5 py-3 bg-primary-container">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 bg-secondary-container rounded-md flex items-center justify-center text-white font-black text-xs">F</div>
                                <span className="text-white font-bold text-xs tracking-wide">FORMA TECH LTD.</span>
                              </div>
                              <div className="text-right">
                                <div className="text-secondary-container font-black text-sm tracking-widest">INVOICE</div>
                                <div className="text-slate-400 text-[9px] font-mono">#INV-2026-00841</div>
                              </div>
                            </div>
                            {/* Meta row */}
                            <div className="flex justify-between px-5 py-3 bg-surface-container-low border-b border-outline-variant text-[9px] font-mono text-on-surface-variant">
                              <div><span className="text-slate-400 uppercase tracking-wider">Issued</span><br /><span className="text-on-surface font-bold">12 July 2026</span></div>
                              <div className="text-right"><span className="text-slate-400 uppercase tracking-wider">Due</span><br /><span className="text-on-surface font-bold">26 July 2026</span></div>
                            </div>
                            {/* Table */}
                            <table className="w-full" style={{ fontSize: 9, borderCollapse: 'collapse' }}>
                              <thead>
                                <tr className="bg-surface-container text-on-surface-variant font-mono uppercase tracking-wider" style={{ fontSize: 8 }}>
                                  <th className="text-left px-5 py-2">Description</th>
                                  <th className="text-center px-2 py-2">Qty</th>
                                  <th className="text-right px-3 py-2">Unit</th>
                                  <th className="text-right px-5 py-2">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  ['AI Report Parser Pro License', '1', '$450.00', '$450.00'],
                                  ['DevExpress REPX Exporter Plugin', '1', '$220.00', '$220.00'],
                                  ['Priority Support 6 months', '1', '$80.00', '$80.00'],
                                ].map(([desc, qty, unit, total], i) => (
                                  <tr key={i} className="border-b border-outline-variant cursor-pointer hover:bg-orange-50 transition-colors" onClick={() => setSelectedElement(currentElements[i] ?? null)}>
                                    <td className="px-5 py-2 text-on-surface font-medium">{desc}</td>
                                    <td className="px-2 py-2 text-center text-on-surface-variant">{qty}</td>
                                    <td className="px-3 py-2 text-right text-on-surface-variant">{unit}</td>
                                    <td className="px-5 py-2 text-right font-bold text-on-surface">{total}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {/* Totals */}
                            <div className="flex justify-end px-5 py-3 border-t border-outline-variant bg-surface-container-low">
                              <div className="text-right space-y-1">
                                <div className="flex gap-10 text-[9px] text-on-surface-variant"><span>Subtotal</span><span className="font-bold text-on-surface">$750.00</span></div>
                                <div className="flex gap-10 text-[9px] text-on-surface-variant"><span>Tax (18%)</span><span className="font-bold text-on-surface">$135.00</span></div>
                                <div className="flex gap-8 text-[11px] font-black text-secondary-container border-t border-outline-variant pt-1"><span>Total Due</span><span>$885.00</span></div>
                              </div>
                            </div>
                            {/* Footer */}
                            <div className="px-5 py-2 text-[8px] text-slate-400 font-mono border-t border-outline-variant flex justify-between">
                              <span>forma-tech.ai</span><span>Page 1 of 1</span>
                            </div>
                          </div>
                        )}

                        {/* ── RECEIPT CANVAS ── */}
                        {selectedTemplate === 'receipt' && (
                          <div className="mx-auto bg-surface-container-lowest font-mono" style={{ maxWidth: 260, padding: '16px 20px' }}>
                            <div className="text-center mb-3">
                              <div className="text-[11px] font-black tracking-widest text-on-surface uppercase">FORMA CONVENIENCE</div>
                              <div className="text-[8px] text-slate-400 mt-0.5">123 Dev Street, Tech District</div>
                              <div className="text-[8px] text-slate-400">Tel: +91-98001-22233</div>
                            </div>
                            <div className="border-t border-dashed border-outline-variant my-2"></div>
                            <div className="flex justify-between text-[8px] text-on-surface-variant mb-3"><span>Date: 12-Jul-2026</span><span>14:22 IST</span></div>
                            <div className="space-y-1.5 text-[9px]">
                              {[
                                ['1x Premium Latte', 'Rs.380'],
                                ['2x Butter Croissant', 'Rs.510'],
                                ['1x Orange Juice', 'Rs.190'],
                              ].map(([item, price], i) => (
                                <div key={i} className="flex justify-between text-on-surface cursor-pointer hover:bg-surface-container-low px-1 rounded transition-colors" onClick={() => setSelectedElement(currentElements[i] ?? null)}>
                                  <span>{item}</span><span className="font-bold">{price}</span>
                                </div>
                              ))}
                            </div>
                            <div className="border-t border-dashed border-outline-variant my-2"></div>
                            <div className="flex justify-between text-[9px] text-on-surface-variant mb-1"><span>Subtotal</span><span>Rs.1,080</span></div>
                            <div className="flex justify-between text-[9px] text-on-surface-variant mb-2"><span>GST (5%)</span><span>Rs.54</span></div>
                            <div className="flex justify-between text-[11px] font-black text-on-surface border-t border-outline-variant pt-1"><span>TOTAL</span><span>Rs.1,134</span></div>
                            <div className="border-t border-dashed border-outline-variant my-3"></div>
                            <div className="flex flex-col items-center">
                              <div className="flex gap-[1px] items-end h-10 mb-1">
                                {[...Array(40)].map((_, i) => (
                                  <div key={i} className="bg-slate-800" style={{ width: i % 3 === 0 ? 2 : 1, height: `${50 + (i % 5) * 10}%` }}></div>
                                ))}
                              </div>
                              <span className="text-[7px] text-slate-400">TX-99812-OK</span>
                            </div>
                            <div className="text-center text-[8px] text-slate-400 mt-3">Thank you for shopping!</div>
                          </div>
                        )}

                        {/* ── BADGE CANVAS ── */}
                        {selectedTemplate === 'badge' && (
                          <div className="flex items-center justify-center py-4">
                            <div className="bg-surface-container-lowest border-2 border-outline-variant rounded-2xl shadow-lg overflow-hidden font-sans" style={{ width: 220 }}>
                              <div className="bg-secondary-container px-4 py-2 flex items-center justify-between">
                                <div>
                                  <div className="text-white font-black text-[10px] tracking-widest uppercase">FORMA TECHNOLOGIES</div>
                                  <div className="text-orange-200 text-[7px] tracking-wider font-mono">Employee Identity Card</div>
                                </div>
                                <div className="text-white/30 font-black text-xl">F</div>
                              </div>
                              <div className="px-4 pt-4 pb-3 flex gap-4 items-start">
                                <div className="shrink-0">
                                  <div className="w-16 h-20 bg-surface-container rounded-lg border border-outline-variant flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-secondary-container transition-colors" onClick={() => setSelectedElement(currentElements[1] ?? null)}>
                                    <ImageIcon size={18} className="text-slate-400" />
                                    <span className="text-[7px] text-slate-400 font-mono">Photo</span>
                                  </div>
                                </div>
                                <div className="flex-1 space-y-2 pt-1">
                                  {[
                                    ['Full Name', 'Waqar Sayyed', 'text-[11px] font-black text-on-surface'],
                                    ['Role', 'Software Engineer', 'text-[10px] text-on-surface-variant'],
                                    ['Department', 'Engineering', 'text-[10px] text-on-surface-variant'],
                                    ['EMP ID', 'EMP-92727', 'text-[10px] font-mono font-bold text-secondary-container'],
                                  ].map(([lbl, val, cls], i) => (
                                    <div key={i} className="cursor-pointer hover:bg-surface-container-low rounded px-1 transition-colors" onClick={() => setSelectedElement(currentElements[i] ?? null)}>
                                      <div className="text-[8px] text-slate-400 uppercase tracking-wider font-mono">{lbl}</div>
                                      <div className={cls}>{val}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="border-t border-dashed border-outline-variant mx-4 mb-2"></div>
                              <div className="flex flex-col items-center pb-3">
                                <div className="flex gap-[1px] items-end h-8 mb-1">
                                  {[...Array(36)].map((_, i) => (
                                    <div key={i} className="bg-slate-800" style={{ width: i % 3 === 0 ? 2 : 1, height: `${50 + (i % 4) * 12}%` }}></div>
                                  ))}
                                </div>
                                <span className="text-[7px] text-slate-400 font-mono">EMP-92727 · FORMA-2026</span>
                              </div>
                              <div className="bg-surface-container-low border-t border-outline-variant px-4 py-1.5 flex justify-between items-center">
                                <span className="text-[7px] text-slate-400 font-mono">Valid: 2026 - 2028</span>
                                <span className="text-[7px] text-secondary-container font-bold font-mono">ACTIVE</span>
                              </div>
                            </div>
                          </div>
                        )}

                      </div>

                      {/* Element inspector */}
                      {selectedElement ? (
                        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 grid grid-cols-4 gap-3">
                          {[
                            { label: 'ID', value: selectedElement.id },
                            { label: 'Type', value: selectedElement.type.toUpperCase() },
                            { label: 'Position', value: `${selectedElement.x}, ${selectedElement.y}` },
                            { label: 'Size', value: `${selectedElement.w} x ${selectedElement.h}` },
                          ].map(({ label, value }) => (
                            <div key={label}>
                              <span className="text-[8px] font-mono text-on-surface-variant uppercase tracking-wider block">{label}</span>
                              <span className="text-[10px] font-mono text-white font-bold truncate block">{value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-center text-on-surface font-mono">Click any element on the canvas to inspect it</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── PANEL 3: Live Code Output (4 cols) ─────────────────── */}
              <div className="xl:col-span-4 flex flex-col">
                {/* Tabs */}
                <div className="flex border-b border-slate-800/60 overflow-x-auto no-scrollbar">
                  {[
                    { id: 'repx' as const, label: '.REPX', color: 'text-teal-400 border-teal-400' },
                    { id: 'json' as const, label: 'JSON', color: 'text-blue-400 border-blue-400' },
                    { id: 'markdown' as const, label: '.MD', color: 'text-violet-400 border-violet-400' },
                  ].map(({ id, label, color }) => (
                    <button
                      key={id}
                      onClick={() => { setActiveTab(id); }}
                      className={`px-5 py-4 text-[10px] font-mono font-bold uppercase tracking-widest border-b-2 whitespace-nowrap transition-all cursor-pointer ${activeTab === id ? color : 'text-on-surface-variant border-transparent hover:text-slate-400'
                        }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Code view with AnimatePresence smooth tab transition */}
                <div className="flex-1 relative overflow-hidden">
                  {parseStatus !== 'done' ? (
                    <div className="h-full flex items-center justify-center text-on-surface font-mono text-[11px] text-center px-6">
                      <div>
                        <FileCode size={32} strokeWidth={1} className="mx-auto mb-3 text-on-surface" />
                        Run the parser to generate<br />live DevExpress output
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Copy button */}
                      <button
                        onClick={() => {
                          const text = activeTab === 'repx' ? generateRepxXml(selectedTemplate, currentElements)
                            : activeTab === 'json' ? generateJsonMap(selectedTemplate, currentElements)
                              : generateMarkdownSpec(selectedTemplate, currentElements);
                          handleCopy(text);
                        }}
                        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-lg text-[9px] font-mono font-bold transition-all cursor-pointer select-none"
                      >
                        {copied ? <><CheckCircle size={10} className="text-green-400" /> Copied!</> : <><FileCode size={10} /> Copy</>}
                      </button>

                      {/* Scrollable code with Framer Motion AnimatePresence tab transition */}
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={activeTab}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                          className="absolute inset-0 overflow-auto p-4 pt-12 font-mono text-[10px] leading-[1.6] no-scrollbar"
                        >
                          {activeTab === 'repx' && renderXmlCode(generateRepxXml(selectedTemplate, currentElements))}
                          {activeTab === 'json' && renderJsonCode(generateJsonMap(selectedTemplate, currentElements))}
                          {activeTab === 'markdown' && renderMarkdownCode(generateMarkdownSpec(selectedTemplate, currentElements))}
                        </motion.div>
                      </AnimatePresence>
                    </>
                  )}
                </div>

                {/* Status footer */}
                <div className="px-5 py-3 border-t border-slate-800/60 flex items-center justify-between">
                  <span className="text-[9px] font-mono text-on-surface">Engine: v2.4-Aida</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${parseStatus === 'done' ? 'bg-green-500' : 'bg-slate-700'}`}></div>
                    <span className="text-[9px] font-mono text-on-surface">{parseStatus === 'done' ? `${currentElements.length} nodes mapped` : 'Standby'}</span>
                  </div>
                </div>
              </div>

            </div>{/* end studio grid */}
          </div>
        </motion.section>

        {/* CTA section with Scroll Reveal & Hover Scale */}
        <motion.section
          ref={ctaRef}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.65, ease: EASE.standard }}
          className="py-24 bg-gradient-to-b from-surface to-surface-container border-t border-outline-variant text-center relative overflow-hidden"
        >
          {/* Background orbs. Static: two blur-3xl circles drifting on endless 8s
              and 10s loops is an expensive composite for an effect nobody can
              consciously perceive. The colour wash is retained. */}
          <div className="absolute -left-32 -bottom-32 w-80 h-80 bg-secondary-container/8 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -right-24 -top-24 w-64 h-64 bg-violet-400/8 rounded-full blur-3xl pointer-events-none" />

          <div className="max-w-6xl mx-auto px-6 relative z-10">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-3xl md:text-4xl font-bold mb-6 tracking-tight text-on-surface"
            >
              Ready to integrate intelligence?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-base text-on-surface-variant max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              Launch our workspace, load mockups, and convert design wires to native DevExpress serialized outputs instantly.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="flex flex-col sm:flex-row justify-center gap-4"
            >
              {/* Pulsing ring + CTA button */}
              <div className="relative inline-flex items-center justify-center">
                {ctaInView && !prefersReduced && (
                  <motion.div
                    className="absolute inset-0 rounded-full bg-secondary-container/30 pointer-events-none"
                    animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                  />
                )}
                <motion.button
                  whileHover={{ scale: 1.05, boxShadow: "0 20px 40px -8px rgba(254, 107, 0, 0.4)" }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onEnterWorkspace}
                  className="relative bg-secondary-container hover:bg-[#e05a00] text-white px-12 py-4 font-label-caps transition-colors rounded-full shadow-lg shadow-secondary-container/20 text-sm font-bold cursor-pointer"
                >
                  Launch Designer Workspace
                </motion.button>
              </div>
              <motion.a
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                href="/docs"
                className="border border-outline-variant text-on-surface px-8 py-4 font-label-caps transition-colors hover:bg-black hover:text-white rounded-full flex items-center justify-center gap-2 cursor-pointer text-sm font-semibold"
              >
                Explore Documentation <ArrowRight size={16} />
              </motion.a>
            </motion.div>
          </div>
        </motion.section>
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
              © 2026 Forma. All rights reserved.<br />Designed & Built by <strong className="text-secondary-container font-bold">Waqar Sayyed</strong>
            </p>
          </div>

          {/* Middle side: Navigation links */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 select-none text-[12px]">
            <a href="/" className="hover:text-primary transition-all duration-200 hover:scale-105">Product</a>
            <span className="text-outline-variant text-[21px] font-bold">•</span>
            <a href="/features" className="hover:text-primary transition-all duration-200 hover:scale-105">Features</a>
            <span className="text-outline-variant text-[21px] font-bold">•</span>
            <a href="/docs" className="hover:text-primary transition-all duration-200 hover:scale-105">Docs</a>
            <span className="text-outline-variant text-[21px] font-bold">•</span>
            <a href="/contact" className="hover:text-primary transition-all duration-200 hover:scale-105">Contact</a>
            <span className="text-outline-variant text-[21px] font-bold">•</span>
            <a href="/" className="hover:text-primary transition-all duration-200 text-on-surface-variant/70 hover:scale-105">Privacy</a>
            <span className="text-outline-variant text-[21px] font-bold">•</span>
            <a href="/" className="hover:text-primary transition-all duration-200 text-on-surface-variant/70 hover:scale-105">Terms</a>
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
}
