import Link from 'next/link';
import { Space_Grotesk } from 'next/font/google';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] });

export default function GuidePage() {
  return (
    <div className={`${spaceGrotesk.className} min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800`}>
      <div className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70">
        <div className="absolute inset-0">
          <div className="absolute -top-24 -right-20 h-72 w-72 rounded-full bg-gradient-to-br from-blue-300/30 to-purple-400/30 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gradient-to-tr from-emerald-300/20 to-cyan-400/30 blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto px-6 py-12 md:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-600 dark:text-blue-300">HyperArc Guide</p>
          <h1 className="mt-4 text-4xl md:text-5xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Overview & Flow
          </h1>
          <p className="mt-4 max-w-2xl text-base md:text-lg text-slate-600 dark:text-slate-300">
            A quick briefing on platform operations, roles, and capital flow before you invest.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/"
              className="px-5 py-3 rounded-lg bg-slate-900 text-white font-medium shadow-md hover:bg-slate-800 transition-colors"
            >
              Back to Home
            </Link>
            <span className="px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-900/60">
              Powered by Circle Wallet
            </span>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-12 space-y-10">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: 'Investor',
              desc: 'Browse approved offerings, subscribe with USDC, and track dividends.',
              tag: 'Investor',
            },
            {
              title: 'Issuer',
              desc: 'Create SPV offerings, raise on-chain, and distribute returns.',
              tag: 'Issuer / SPV',
            },
            {
              title: 'Platform',
              desc: 'Ensures compliance workflows, custody, and on-chain records.',
              tag: 'HyperArc',
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-300">
                {card.tag}
              </p>
              <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{card.desc}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-6 md:p-8 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">End-to-End Flow</h2>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { step: '01', title: 'Connect Wallet', desc: 'Sign in with MetaMask and verify access.' },
              { step: '02', title: 'Select Offering', desc: 'Review approved assets and terms.' },
              { step: '03', title: 'Subscribe', desc: 'Enter a USDC amount and sign the transaction.' },
              { step: '04', title: 'Track Returns', desc: 'Monitor holdings and dividends in Portfolio.' },
            ].map((item) => (
              <div key={item.step} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{item.step}</p>
                <p className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{item.title}</p>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">Security & Compliance</h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <li>Subscriptions are executed on-chain with verifiable funds flow.</li>
              <li>Offerings go live only after internal approval checks.</li>
              <li>Dividend distribution follows automated contract logic.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-6 shadow-sm">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-white">FAQ</h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <li>All subscriptions are priced and settled in USDC.</li>
              <li>Portfolio shows positions and pending dividends.</li>
              <li>Issuers can declare dividends and withdraw subscriptions.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
