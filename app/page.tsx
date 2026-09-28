import Link from "next/link";
import { ArrowRightIcon, ChartNoAxesCombinedIcon } from "lucide-react";

export default function Home() {
  return (
    <div className="space-y-12">
      <section aria-labelledby="directory-heading" className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Use case directory
        </p>
        <h1
          className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl"
          id="directory-heading"
        >
          Build from a working example.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          Explore a focused agent workflow, try it with sample data, and adapt the source for
          your own project.
        </p>
      </section>

      <section aria-labelledby="examples-heading">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <h2 className="text-sm font-semibold text-foreground" id="examples-heading">
            Available examples
          </h2>
          <span className="text-xs tabular-nums text-muted-foreground">01 example</span>
        </div>

        <Link
          className="group mt-5 block rounded-sm border border-border bg-card outline-none transition-colors hover:border-foreground/35 focus-visible:ring-2 focus-visible:ring-ring"
          href="/transactions"
        >
          <div className="grid gap-10 p-6 md:flex md:items-center md:gap-8 md:p-8 lg:p-10">
            <div className="min-w-0 md:flex-1">
              <div className="mb-7 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-sm border border-border bg-secondary text-foreground">
                  <ChartNoAxesCombinedIcon aria-hidden="true" className="size-4" />
                </span>
                <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Finance / 01
                </span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-foreground">
                Financial transaction classification
              </h3>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Upload your own CSV or use fictional transactions. Follow every row through
                rules and Jev classification as the workflow runs.
              </p>
            </div>

            <div className="border-t border-border pt-5 md:w-64 md:shrink-0 md:border-l md:border-t-0 md:py-2 md:pl-8">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Try in this example
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-foreground">
                <li>CSV or sample transactions</li>
                <li>Live batch progress</li>
                <li>Step-by-step row detail</li>
              </ul>
            </div>

            <span className="flex size-9 items-center justify-center rounded-sm border border-border transition-colors group-hover:border-foreground group-hover:bg-foreground group-hover:text-background md:self-start">
              <ArrowRightIcon aria-hidden="true" className="size-4" />
            </span>
          </div>
        </Link>
      </section>

      <p className="border-t border-border pt-5 text-xs text-muted-foreground">
        Designed to be read, changed, and extended. Built with Next.js, EVE, Jev, and Workflow SDK.
      </p>
    </div>
  );
}
