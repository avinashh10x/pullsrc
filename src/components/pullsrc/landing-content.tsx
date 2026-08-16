import { LandingExtension } from "@/components/pullsrc/landing-extension"
import { EXTRACTED, FAQ, HOW_IT_WORKS } from "@/lib/pullsrc/seo"

// The only indexable prose on the site, and the same copy seo.ts describes.
export function LandingContent() {
  return (
    <div className="w-full bg-background">
      <section
        aria-labelledby="how-it-works"
        className="mx-auto w-full max-w-5xl px-4 py-20"
      >
        <h2
          id="how-it-works"
          className="font-heading text-3xl uppercase tracking-normal text-foreground sm:text-4xl"
        >
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-primary font-mono text-sm text-primary-foreground">
                {index + 1}
              </span>
              <h3 className="mt-4 text-lg font-medium text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        aria-labelledby="what-it-extracts"
        className="mx-auto w-full max-w-5xl px-4 pb-20"
      >
        <h2
          id="what-it-extracts"
          className="font-heading text-3xl uppercase tracking-normal text-foreground sm:text-4xl"
        >
          What PullSRC extracts
        </h2>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          Every scan sorts what it finds into these categories, and each asset
          arrives with its source URL, file type, and size already attached.
        </p>
        <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {EXTRACTED.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <dt className="text-lg font-medium text-foreground">
                {item.title}
              </dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                {item.body}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <LandingExtension />

      <section
        aria-labelledby="faq"
        className="mx-auto w-full max-w-5xl px-4 pb-24"
      >
        <h2
          id="faq"
          className="font-heading text-3xl uppercase tracking-normal text-foreground sm:text-4xl"
        >
          Frequently asked questions
        </h2>
        <dl className="mt-8 max-w-3xl divide-y divide-border border-y border-border">
          {FAQ.map((item) => (
            <div key={item.q} className="py-6">
              <dt className="text-base font-medium text-foreground">
                {item.q}
              </dt>
              <dd className="mt-2 text-sm leading-6 text-muted-foreground">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}
